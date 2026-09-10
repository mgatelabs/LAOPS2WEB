import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideZoneChangeDetection } from '@angular/core';
import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { CatalogService } from './core/catalog.service';
import { ScenesCatalogService } from './core/scenes-catalog.service';
import { SettingsService } from './core/settings.service';
import { firstValueFrom } from 'rxjs';

function initApp(
  assets: CatalogService,
  scenes: ScenesCatalogService,
  settings: SettingsService,
  http: HttpClient,
) {
  return () => Promise.all([
    assets.load(),
    scenes.load(),
    firstValueFrom(http.get<any>('assets/i18n/locales.json'))
      .then(data => settings.loadLocales(data))
      .catch(() => {}),
  ]);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch()),
    provideAnimations(),
    ...(TranslateModule.forRoot({
      loader: {
        provide: TranslateLoader,
        useFactory: (http: HttpClient) => new TranslateHttpLoader(http, 'assets/i18n/'),
        deps: [HttpClient]
      },
      defaultLanguage: 'en'
    }).providers ?? []),
    {
      provide: APP_INITIALIZER,
      useFactory: initApp,
      deps: [CatalogService, ScenesCatalogService, SettingsService, HttpClient],
      multi: true,
    },
  ]
};
