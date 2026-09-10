const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
const dist = path.join(root, "..", "dist");
const temp = path.join(root, "..", ".gh-pages-deploy");

const remote = "git@github.com:mgatelabs/LAOPS2WEB.git";
const branch = "gh-pages";

function run(command, args, cwd = temp) {
    console.log(`> ${command} ${args.join(" ")}`);

    execFileSync(command, args, {
        cwd,
        stdio: "inherit",
        windowsHide: true
    });
}

function removeDirectoryContents(directory) {
    if (!fs.existsSync(directory)) {
        return;
    }

    for (const entry of fs.readdirSync(directory)) {
        fs.rmSync(path.join(directory, entry), {
            recursive: true,
            force: true
        });
    }
}

try {
    // ------------------------------------------------------------
    // Check dist
    // ------------------------------------------------------------

    if (!fs.existsSync(dist)) {
        throw new Error(`dist directory does not exist:\n${dist}`);
    }

    console.log(`Using dist: ${dist}`);

    // ------------------------------------------------------------
    // Remove old temporary repository
    // ------------------------------------------------------------

    if (fs.existsSync(temp)) {
        console.log("Removing old temporary deployment directory...");
        fs.rmSync(temp, {
            recursive: true,
            force: true
        });
    }

    fs.mkdirSync(temp, {
        recursive: true
    });

    // ------------------------------------------------------------
    // Create completely independent Git repository
    // ------------------------------------------------------------

    console.log("Creating temporary Git repository...");

    run("git", ["init"]);

    // ------------------------------------------------------------
    // Configure Git identity from the main repository
    // ------------------------------------------------------------

    let name;
    let email;

    try {
        name = execFileSync(
            "git",
            ["config", "user.name"],
            {
                cwd: root,
                encoding: "utf8"
            }
        ).trim();
    } catch {}

    try {
        email = execFileSync(
            "git",
            ["config", "user.email"],
            {
                cwd: root,
                encoding: "utf8"
            }
        ).trim();
    } catch {}

    if (name) {
        run("git", ["config", "user.name", name]);
    }

    if (email) {
        run("git", ["config", "user.email", email]);
    }

    // ------------------------------------------------------------
    // Copy dist into temporary repository
    // ------------------------------------------------------------

    console.log("Copying dist...");

    fs.cpSync(dist, temp, {
        recursive: true,
        force: true
    });

    // ------------------------------------------------------------
    // Make sure we're on gh-pages
    // ------------------------------------------------------------

    run("git", ["checkout", "-b", branch]);

    // ------------------------------------------------------------
    // Stage everything
    // ------------------------------------------------------------

    console.log("Staging files...");

    run("git", ["add", "--all"]);

    // ------------------------------------------------------------
    // Commit
    // ------------------------------------------------------------

    console.log("Creating deployment commit...");

    run("git", [
        "commit",
        "-m",
        "Deploy Angular application"
    ]);

    // ------------------------------------------------------------
    // Push directly to gh-pages
    // ------------------------------------------------------------

    console.log("Pushing to GitHub Pages...");

    run("git", [
        "push",
        "--force",
        remote,
        `HEAD:refs/heads/${branch}`
    ]);

    console.log("");
    console.log("========================================");
    console.log(" GitHub Pages deployment successful!");
    console.log("========================================");
    console.log("");
    console.log(`Branch: ${branch}`);
    console.log(`Source: ${dist}`);

} catch (error) {
    console.error("");
    console.error("========================================");
    console.error(" Deployment failed");
    console.error("========================================");
    console.error("");

    if (error.message) {
        console.error(error.message);
    }

    process.exitCode = 1;
} finally {
    // ------------------------------------------------------------
    // Remove temporary repository
    // ------------------------------------------------------------

    if (fs.existsSync(temp)) {
        console.log("");
        console.log("Cleaning up temporary deployment repository...");

        try {
            fs.rmSync(temp, {
                recursive: true,
                force: true
            });
        } catch (error) {
            console.error(
                `Could not remove temporary directory: ${temp}`
            );
        }
    }
}
