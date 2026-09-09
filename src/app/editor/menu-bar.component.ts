import { Component, inject } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsService, Theme } from '../core/settings.service';

@Component({
  selector: 'app-menu-bar',
  standalone: true,
  imports: [
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatDividerModule,
    FormsModule,
    TranslateModule,
  ],
  templateUrl: './menu-bar.component.html',
  styleUrl: './menu-bar.component.scss',
})
export class MenuBarComponent {
  private readonly settings = inject(SettingsService);

  readonly theme = this.settings.theme;
  readonly language = this.settings.language;

  onThemeChange(value: Theme): void {
    this.settings.setTheme(value);
  }

  onLanguageChange(value: string): void {
    this.settings.setLanguage(value);
  }
}
