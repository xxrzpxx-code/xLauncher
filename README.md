# xLauncher

## Uruchomienie (dev)
    npm install
    npm start

## Discord RPC
1. Wejdz na https://discord.com/developers/applications i kliknij "New Application".
2. Skopiuj "Application ID" (to jest ID aplikacji).
3. W zakladce "Rich Presence" > "Art Assets" wgraj obrazek i nadaj mu nazwe "logo".
4. Wklej ID do src/config.json w polu "discordClientId".
5. Discord na komputerze musi byc uruchomiony. Status pokaze sie po starcie gry.

## Budowanie exe i instalatora
    npm run build
Gotowy instalator: dist/xLauncher-Setup-<wersja>.exe

## Automatyczne aktualizacje i wydania (zalecane)
1. Zaloz publiczne repozytorium na GitHubie i wypchnij do niego projekt.
   (Publiczne repo jest potrzebne, zeby launcher mogl sprawdzac aktualizacje bez tokena.)
2. Przy kazdej nowej wersji podbij "version" w package.json (np. 1.0.1), zrob commit i:
       git tag v1.0.1
       git push origin v1.0.1
3. GitHub Actions (plik .github/workflows/release.yml) sam zbuduje exe i instalator na Windowsie
   i opublikuje je w zakladce Releases razem z latest.yml.
4. Zainstalowany launcher sprawdza nowe wersje przy starcie, pobiera je i instaluje po zamknieciu.
