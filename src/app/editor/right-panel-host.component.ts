import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { PropertiesPanelComponent } from '../panels/properties-panel.component';
import { LayersPanelComponent } from '../panels/layers-panel.component';
import { LibraryPanelComponent } from '../panels/library-panel.component';

@Component({
  selector: 'app-right-panel-host',
  standalone: true,
  imports: [
    PropertiesPanelComponent,
    LayersPanelComponent,
    LibraryPanelComponent,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './right-panel-host.component.html',
  styleUrl: './right-panel-host.component.scss',
})
export class RightPanelHostComponent {
  propertiesOpen = signal(true);
  layersOpen = signal(true);
  libraryOpen = signal(true);

  toggleProperties() {
    this.propertiesOpen.update(v => !v);
  }

  toggleLayers() {
    this.layersOpen.update(v => !v);
  }

  toggleLibrary() {
    this.libraryOpen.update(v => !v);
  }
}
