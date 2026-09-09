import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';

interface LayerRow {
  id: string;
  label: string;
  typeIcon: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
}

@Component({
  selector: 'app-layers-panel',
  standalone: true,
  imports: [
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    TranslateModule,
    CommonModule,
  ],
  templateUrl: './layers-panel.component.html',
  styleUrl: './layers-panel.component.scss',
})
export class LayersPanelComponent {
  hasMultiSelection = false;

  rows: LayerRow[] = [
    { id: '1', label: 'Gordon Freeman', typeIcon: 'image', visible: true, locked: false, selected: true },
    { id: '2', label: 'Background', typeIcon: 'crop_square', visible: true, locked: true, selected: false },
    { id: '3', label: 'Title Text', typeIcon: 'title', visible: false, locked: false, selected: false },
    { id: '4', label: 'Combine Squad', typeIcon: 'folder', visible: true, locked: false, selected: false },
    { id: '5', label: 'Explosion', typeIcon: 'radio_button_unchecked', visible: true, locked: false, selected: false },
  ];
}
