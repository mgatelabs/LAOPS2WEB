import { Component } from '@angular/core';
import { EditorShellComponent } from './editor/editor-shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EditorShellComponent],
  template: `<app-editor-shell />`,
  styles: [`
    :host { display: block; height: 100%; }
  `]
})
export class AppComponent {
  constructor() {
    const body = document.body;
    if (!body.classList.contains('laops-light-theme') && !body.classList.contains('laops-dark-theme')) {
      body.classList.add('laops-light-theme');
    }
  }
}
