import { Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslateModule } from '@ngx-translate/core';
import { AssetPanelComponent } from './asset-panel.component';
import { ScenePanelComponent } from './scene-panel.component';

@Component({
  selector: 'app-library-panel',
  standalone: true,
  imports: [MatTabsModule, AssetPanelComponent, ScenePanelComponent, TranslateModule],
  templateUrl: './library-panel.component.html',
  styleUrl: './library-panel.component.scss',
})
export class LibraryPanelComponent {}
