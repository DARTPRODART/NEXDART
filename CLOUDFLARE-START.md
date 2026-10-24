NEXDART — migracja na Cloudflare Pages

Ta gałąź przygotowuje aplikację do Cloudflare Pages. Nie usuwaj projektu Netlify ani nie zmieniaj bazy Supabase, dopóki nowa wersja nie zostanie przetestowana.

Pliki:
- index.html — frontend, API korzysta z /api/state i /api/articles
- functions/api/state.js — endpoint stanu ligi
- functions/api/articles.js — endpoint aktualności
- functions/_shared.js — wspólna obsługa Supabase i weryfikacji administratora
- _routes.json — uruchamiaj funkcje tylko dla ścieżek /api/*

Konfiguracja Cloudflare Pages:
- Połącz repozytorium GitHub DARTPRODART/NEXDART z gałęzią cloudflare-migration.
- Build command: pozostaw puste, jeśli panel pozwala; w przeciwnym razie użyj `exit 0`.
- Build output directory: katalog główny repozytorium (`.`).
- Nie używaj folderu netlify jako folderu funkcji; Cloudflare Pages używa folderu functions.

Dodaj w ustawieniach projektu Cloudflare Pages zmienne środowiskowe (Production):
- SUPABASE_URL — adres projektu Supabase
- SUPABASE_ANON_KEY — publiczny klucz Supabase
- SUPABASE_SERVICE_ROLE_KEY — tajny klucz service_role, oznacz jako secret; nigdy nie umieszczaj go w index.html
- ADMIN_USER_ID — identyfikator użytkownika Supabase Authentication, który ma uprawnienia administratora

Dodaj te same zmienne w Preview tylko jeśli będziesz testować podglądy.
Nie wpisuj wartości kluczy do GitHuba ani do tego pliku.

WAŻNE:
- Ta gałąź jest oddzielona od main; zmiany nie zastępują aktualnej wersji repozytorium.
- Przed uruchomieniem na produkcji przetestuj publiczny odczyt stanu, logowanie administratora, zapis wyników, aktualności oraz eksport/import w panelu admina.
- Dane pozostają w Supabase; migracja hostingu sama w sobie nie wymaga przenoszenia rekordów.
