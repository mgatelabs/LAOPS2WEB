export interface FontDef {
  key: string;       // translation key, e.g. 'FONT.SANS_SERIF'
  stack: string;     // CSS font-family value stored in TextNode.font
}

export const FONTS: FontDef[] = [
  { key: 'FONT.SANS_SERIF',        stack: 'Arial, Helvetica, sans-serif' },
  { key: 'FONT.SERIF',             stack: 'Georgia, "Times New Roman", serif' },
  { key: 'FONT.MONOSPACE',         stack: '"Courier New", Courier, monospace' },
  { key: 'FONT.IMPACT',            stack: 'Impact, "Arial Narrow", sans-serif' },
  { key: 'FONT.COMIC',             stack: '"Comic Sans MS", "Comic Sans", cursive' },
  { key: 'FONT.NARROW',            stack: '"Arial Narrow", Arial, sans-serif' },
  { key: 'FONT.CONDENSED',         stack: '"Franklin Gothic Medium", "Arial Narrow", sans-serif' },
  { key: 'FONT.HANDWRITING',       stack: '"Segoe Print", "Bradley Hand", cursive' },
  { key: 'FONT.SYSTEM',            stack: 'system-ui, -apple-system, sans-serif' },
];
