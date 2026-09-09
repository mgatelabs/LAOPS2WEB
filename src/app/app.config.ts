import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideZoneChangeDetection } from '@angular/core';
import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { CatalogService } from './core/catalog.service';
import { ScenesCatalogService } from './core/scenes-catalog.service';

function initCatalogues(assets: CatalogService, scenes: ScenesCatalogService) {
  return () => Promise.all([assets.load(), scenes.load()]);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
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
      useFactory: initCatalogues,
      deps: [CatalogService, ScenesCatalogService],
      multi: true,
    },
  ]
};
