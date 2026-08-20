# Deal watcher — HVD Reina del Mar (Obzor, Bulgaria)

Bot de Telegram care verifica automat pretul pentru **3 adulti + 1 copil (12 ani), 6 nopti,
sfarsit de iulie / inceput de august 2027** si iti scrie pe Telegram cand apare ceva bun:
pret nou minim, scadere de pret, sau pur si simplu cand hotelul deschide rezervarile pentru vara viitoare.

```
🔥 Cel mai mic pret de pana acum
🏨 HVD Reina del Mar — site oficial
📅 Sam 24 iul → Vin 30 iul 2027 (6 nopti)
👨‍👩‍👧 3 adulti + 1 copil 12 ani
💶 1.240 EUR total · 51,67 EUR/pers/noapte
📉 -270 EUR (-17.9%) fata de minimul anterior
🛏 Family Room Sea View · Ultra All Inclusive
🔗 deschide oferta
```

## Cel mai important lucru de stiut

Pentru vacanta de **anul viitor**, banii nu se fac din scaderi mici de pret, ci din **early booking**.
Hotelurile din Bulgaria isi publica tarifele pentru vara urmatoare cam **septembrie–noiembrie**, iar
touroperatorii romani scot ofertele de early booking **noiembrie–februarie**, cu 25–40% reducere.
Alea sunt, aproape mereu, cele mai mici preturi din tot anul.

De asta botul nu urmareste doar preturi: te anunta si **in momentul in care datele tale devin
rezervabile prima oara** (`🆕 S-a eliberat disponibilitate`). Porneste-l acum si lasa-l sa mearga —
alerta care conteaza cel mai mult o sa vina prin toamna.

## Ce trebuie sa faci tu (o singura data, ~10 minute)

### 1. Fa-ti bot de Telegram

1. Scrie-i lui [@BotFather](https://t.me/BotFather) pe Telegram → `/newbot` → alege un nume.
2. Copiaza tokenul pe care ti-l da.
3. Deschide conversatie cu botul tau si trimite-i `/start` (altfel nu-ti poate scrie el primul).

```bash
cd deal-watcher
npm install
npx playwright install chromium
cp .env.example .env       # pune TELEGRAM_BOT_TOKEN aici
npm run ping               # iti afiseaza chat id-ul; pune-l in .env ca TELEGRAM_CHAT_ID
npm run ping               # a doua oara iti trimite un mesaj de test
```

### 2. Invata botul motorul de rezervari al hotelului

Site-urile de hoteluri nu au preturile in HTML — le cer printr-un request separat, in spate.
In loc sa ghicim cum arata acel request, il **inregistram o data**, manual:

```bash
npm run record -- hvd-official
```

Se deschide un Chrome real. Faci **o singura cautare cu mana** (cu datele pe care ti le cere in
terminal), astepti sa apara lista de camere cu preturi, apoi te intorci in terminal si apesi ENTER.
Se salveaza in `recordings/hvd-official.json`.

De aici incolo, la fiecare scanare botul **rejoaca acel request** cu alte date si alta ocupare —
mult mai stabil (si mai politicos cu serverul hotelului) decat sa deschida browserul de fiecare data.

> Daca hotelul nu are inca deschise rezervarile pentru vara 2027, inregistreaza cu **date din
> sezonul curent** (ex. septembrie 2026). Substitutia de date functioneaza la fel, iar botul o sa-ti
> spuna imediat ce apar datele tale.

### 3. Porneste-l

```bash
npm run watch
```

Sau, fara sa te atingi de site-ul real, ca sa vezi cum arata totul:

```bash
# in config.json: sources.mock.enabled = true, sources.hvd-official.enabled = false
npm run once
```

## Comenzi in Telegram

| Comanda | Ce face |
|---|---|
| `/status` | ce urmareste, cand a fost ultimul scan, ce erori are |
| `/best 5` | cele mai ieftine oferte de acum |
| `/now` | forteaza un scan complet imediat |
| `/prag 1500` | alerta cand totalul scade sub 1500 EUR (`/prag 0` scoate pragul) |
| `/pragpn 55` | acelasi lucru, dar pe persoana pe noapte |
| `/fereastra 2027-07-20 2027-08-08` | schimba intervalul de check-in |
| `/nopti 7` | compara si sejururi de 7 nopti (operatorii vand des 7, nu 6) |
| `/pause` · `/resume` | opreste / reia scanarile |
| `/surse` | ce surse merg si care dau erori |

## Ce scaneaza si cat de des

Cu setarile din `config.example.json`:

- **20 date de check-in** (20 iulie → 8 august 2027), fiecare cu sejur de 6 nopti;
- **2 variante de ocupare**: `3 adulti + 1 copil 12` si `4 adulti` — pentru ca multe hoteluri
  taxeaza copilul de 12 ani ca adult, si uneori a doua varianta iese mai ieftina la aceeasi camera;
- **scan complet la 30 min**, plus un scan doar pe datele preferate (25 iul – 3 aug) la 10 min.

„La cateva minute" pe toate combinatiile ar insemna mii de cereri pe zi catre un hotel mic — asa se
ajunge la ban de IP. 30 de minute e mai mult decat suficient: preturile de hotel nu se schimba
la secunda, iar datele pentru anul viitor se misca de cateva ori pe **saptamana**. Daca vrei mai des,
schimba `schedule.fullSweepMinutes` — dar tine `requestDelayMs` cel putin la 2000.

## Cand primesti alerta

| Motiv | Cand |
|---|---|
| 🎯 Sub bugetul setat | pretul trece sub `/prag` sau `/pragpn` |
| 🔥 Cel mai mic pret de pana acum | mai ieftin decat orice s-a vazut vreodata pe acea data |
| 📉 A scazut pretul | scadere de min. 5% fata de scanarea anterioara |
| 🆕 S-a eliberat disponibilitate | datele tale devin rezervabile (early booking!) |
| ⚠️ Nu mai e disponibil | s-au epuizat camerele pe acea data |

Prima scanare e tacuta intentionat (altfel ai primi 40 de mesaje deodata) — memoreaza preturile de
referinta si de la a doua incolo vorbeste doar cand se schimba ceva. Un pret care ramane sub prag nu
te spameaza: exista un cooldown de 6 ore, pe care doar un nou minim absolut il sare.

## Configurare

Tot ce conteaza e in `config.json` (copiat din `config.example.json`):

- `search` — fereastra de date, cate nopti, ce ocupari compari;
- `sources` — de unde scanezi (vezi mai jos);
- `alerts` — praguri, cooldown, ora rezumatului zilnic;
- `schedule` — cat de des si cat de rar trage cereri;
- `currency.rates` — cursurile de conversie; totul se compara in EUR.

### Surse

| Sursa | Adapter | Stare |
|---|---|---|
| `hvd-official` | `replay` | **recomandata** — cere `npm run record` o data |
| `booking` | `generic` | oprita by default, vezi avertismentul de mai jos |
| `directbooking` | `replay` | operator roman; `npm run record -- directbooking` |
| `custom` | `generic` | orice alt site, pe baza de selectori CSS |
| `mock` | `mock` | hotel fictiv, pentru teste fara internet |

Pentru un site nou cu adapterul `generic` completezi in `config.json`:

```json
"urlTemplate": "https://site.ro/cauta?ci={checkIn}&co={checkOut}&adulti={adults}&copii={childCount}&varste={childAges}",
"offerSelector": ".oferta",
"fields": { "title": ".nume-camera", "price": ".pret", "board": ".masa" }
```

Placeholderi: `{checkIn}` `{checkOut}` `{checkInDMY}` `{checkOutDMY}` `{nights}` `{adults}`
`{childCount}` `{childAges}` `{rooms}` `{currency}`.

Optiuni utile pe orice sursa: `priceIs: "perNight"` (daca site-ul afiseaza pret pe noapte),
`titleExclude` / `titleInclude` (regex, ca sa scapi de camere in care nu incapeti),
`bookingUrlTemplate` (link direct pe datele tale, pus in alerta).

### ⚠️ Booking.com

Selectorii din config pentru Booking.com sunt **plauzibili, dar neverificati** — nu am putut deschide
site-ul din mediul in care a fost scris codul, iar Booking isi schimba clasele des. In plus,
scraping-ul lor incalca termenii de utilizare si au protectie anti-bot serioasa. De aceea sursa e
oprita implicit. Site-ul oficial al hotelului e oricum sursa corecta: e si mai ieftin (book direct),
si mai stabil de scanat.

Acelasi lucru e valabil, la scara mai mica, pentru orice sursa `generic`: verifica selectorii cu
`npm run once -- --source <id> --no-telegram` inainte sa te bazezi pe ea.

## Sa mearga non-stop

Botul trebuie sa ruleze undeva 24/7. Trei variante, de la simplu la serios:

**1. Pe laptopul tau** — `npm run watch`. Merge cat timp e pornit laptopul. Bun ca sa testezi.

**2. Docker (VPS, Raspberry Pi, orice)** — cel mai bun raport efort/rezultat:

```bash
export TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
docker compose up -d
```

**3. GitHub Actions** — gratis, fara server, dar cu limite reale:
`.github/workflows/deal-watcher.yml` ruleaza un scan la 30 de minute. Pui `TELEGRAM_BOT_TOKEN` si
`TELEGRAM_CHAT_ID` la repository secrets, plus continutul lui `recordings/hvd-official.json` in
secretul `HVD_RECORDING`. Atentie: cron-ul pe Actions intarzie des cu 5–20 de minute, comenzile din
Telegram (`/status`, `/now`) **nu** merg acolo (nu ruleaza continuu), iar istoricul de preturi sta in
cache-ul Actions, care expira dupa 7 zile de inactivitate.

Pe un server cu systemd ai si `systemd/deal-watcher.service`.

## Limitari, pe fata

- **Selectorii si structura request-ului nu au putut fi verificate pe site-ul real** din mediul unde
  a fost scris codul (accesul la `hvdhotels.com`, `booking.com` etc. e blocat acolo). De asta exista
  `npm run record`: capteaza request-ul real de la tine din browser, deci nu depinde de ghiceli.
  Fluxul complet (record → replay → alerta) e testat cap-coada pe un server fals local.
- **Copil de 12 ani**: multe hoteluri considera „copil" pana la 11.99 ani. Fix de asta scaneaza
  by default si varianta „4 adulti" — daca iese aceeasi camera mai ieftin asa, o vezi in `/best`.
- **4 persoane in camera** au nevoie de family room / apartament. Daca motorul iti intoarce si
  camere in care nu incapeti, filtreaza-le cu `titleExclude`.
- **Pretul afisat** e cel returnat de motor pentru sejurul intreg. Taxe locale, plata la fata locului
  sau conditii de anulare pot diferi — verifica pe site inainte sa dai banii.
- **Sesiunea expira**: daca site-ul incepe sa raspunda 401/403, primesti mesaj pe Telegram si e de
  ajuns sa rulezi din nou `npm run record -- hvd-official`.
- Foloseste-l pentru tine, cu intervale rezonabile. Nu e facut sa bombardeze un hotel cu cereri.

## Dezvoltare

```bash
npm test                                   # 31 de teste, fara internet
npm run once -- --source mock --no-telegram
npm run once -- --hot                      # doar datele preferate
node src/index.js top 10                   # cele mai ieftine, in terminal
```

Structura:

```
src/index.js      CLI + bucla principala (watch/once/record/ping/top/status)
src/sweep.js      o trecere peste toate combinatiile sursa × ocupare × data
src/sources/      adaptoare: replay (request inregistrat), generic (selectori), mock
src/record.js     inregistreaza request-ul motorului de rezervari
src/substitute.js rescrie acel request pentru alte date/ocupare
src/extract.js    scoate ofertele dintr-un JSON de motor de rezervari necunoscut
src/alerts.js     decide daca merita sa te deranjeze (pur, testat)
src/store.js      istoric de preturi si minime, in data/state.json
```
