# EDON MDView

Visualizzatore ed editor visivo Markdown desktop per Windows 10 e 11 (64 bit), con interfaccia in italiano e in inglese e funzionamento locale.

**Sviluppatore:** INFOTREND SRL  
**Licenza:** [FSL-1.1-MIT](LICENSE)

## Perchè

Non trovavamo un md viewer decente ed abbiamo deciso di farlo (Kimi+Fable): lo abbiamo condiviso sperando possa essere utile anche ad altri.

## Avvio

### Installazione consigliata

1. Scarica e apri [EDON MDView Setup](https://github.com/infotrend/edon-mdview/releases/latest/download/EDON-MDView-Setup-1.1.1-x64.exe).
2. Leggi e accetta la licenza nel programma di installazione; non sono necessari privilegi di amministratore.
3. Avvia **EDON MDView** dal menu Start o dal collegamento sul desktop.

L'installazione registra EDON MDView come applicazione per aprire e modificare `.md`, `.markdown`, `.mdown` e `.mkd`. Puoi scegliere EDON MDView dal menu **Apri con** di Windows.

### Versione portabile

Scarica e apri [EDON MDView Portable](https://github.com/infotrend/edon-mdview/releases/latest/download/EDON-MDView-Portable-1.1.1-x64.exe). Non richiede installazione; può essere copiata ed eseguita da una cartella o un'unità USB.

Gli eseguibili includono tutto il necessario: Node.js non deve essere installato. Non essendo firmati con un certificato commerciale, Windows SmartScreen potrebbe chiedere una conferma esplicita.

## Funzioni

- Apertura tramite menu, trascinamento o riga di comando.
- Rendering di titoli, tabelle, elenchi, attività, note, citazioni, collegamenti e codice evidenziato.
- Indice navigabile e ricerca con risultati evidenziati.
- Modifica visiva del documento con salvataggio in Markdown: si formatta con pulsanti e scorciatoie, senza scrivere i simboli a mano.
- Temi chiaro e scuro, zoom e impostazioni persistenti.
- Interfaccia in italiano e in inglese, scelta in base alla lingua del sistema e modificabile dal menu.
- Ricaricamento automatico quando il file viene salvato da un altro programma.
- Apertura di collegamenti ad altri documenti Markdown locali.
- Immagini locali e remote; quelle locali vengono incorporate nell'HTML esportato.
- Esportazione HTML autonoma e stampa, anche in PDF tramite la finestra di stampa di Windows.
- Elenco dei file recenti e associazione alle estensioni Markdown.

## Modifica visiva

Il pulsante **Modifica** (`Ctrl+E`) trasforma il documento visualizzato in un editor: il testo si scrive direttamente nella pagina e la barra degli strumenti applica la formattazione. La lettura resta la modalità predefinita.

- **Strumenti:** titoli da 1 a 6, grassetto, corsivo, barrato, codice in linea, blocco di codice con linguaggio, elenchi puntati, numerati e di attività, citazione, collegamento, immagine, tabella (aggiunta e rimozione di righe e colonne), linea orizzontale, annulla e ripeti.
- **Salvataggio:** **Salva** (`Ctrl+S`) scrive sul file aperto, **Salva con nome** (`Ctrl+Maiusc+S`) su un nuovo file. Un pallino nel titolo e la barra di stato segnalano le modifiche non salvate; prima di chiudere, aprire un altro documento o uscire dalla modifica l'app chiede se salvarle.
- **Modifiche esterne:** se il file cambia su disco mentre ci sono modifiche non salvate, l'app chiede se ricaricarlo o mantenere il proprio lavoro; senza modifiche in corso lo aggiorna da sola.
- **Ricerca:** `Ctrl+F` funziona anche durante la modifica, senza alterare il documento; il contenuto degli elementi protetti non viene cercato.

### Fedeltà del Markdown

Il salvataggio riscrive solo i blocchi realmente modificati (un paragrafo, un elenco, una tabella…): tutto il resto del file resta identico, byte per byte, compresi i fine riga. Aprire un documento, entrare in modifica e salvare senza toccare nulla non cambia il file.

I costrutti senza un equivalente visivo sono mostrati come elementi protetti: non si modificano dall'editor, ma si possono spostare o eliminare e vengono salvati esattamente come sono.

- blocchi HTML e tag HTML in linea (per esempio `<kbd>` o `<br>`);
- note a piè di pagina: richiami `[^1]` e definizioni;
- definizioni di collegamento in stile riferimento (`[rif]: indirizzo`);
- intestazione YAML (front matter) in testa al file.

Dentro un blocco modificato il Markdown viene uniformato:

- enfasi con `*` e `**`, elenchi con `-`, numerazione `1.` `2.` `3.`, titoli sempre con `#`, linee orizzontali con `---`;
- codice indentato trasformato in blocco delimitato da ` ``` `, tabelle con barre compatte (l'allineamento delle colonne resta);
- collegamenti `[testo][rif]` riscritti come `[testo](indirizzo)`;
- righe spezzate a mano dentro un paragrafo riunite in una sola riga;
- entità come `&nbsp;` sostituite dal carattere corrispondente;
- modificare una voce riscrive l'intero elenco, modificare una cella l'intera tabella.

Le celle delle tabelle contengono solo testo in linea. In modifica `--` e le virgolette appaiono come sono scritti nel file: la sostituzione tipografica avviene solo in lettura.

## Lingua

L'interfaccia è disponibile in italiano e in inglese: menu, barre, finestre di dialogo, messaggi e suggerimenti.

- **All'avvio:** se la lingua di Windows è l'italiano l'app parte in italiano, in tutti gli altri casi in inglese.
- **Cambio manuale:** **Visualizza → Lingua → Italiano / Inglese** (in inglese **View → Language → Italian / English**). Il cambio è immediato, senza riavvio, e non tocca il documento aperto né le modifiche non salvate.
- **Scelta ricordata:** la lingua scelta dal menu viene salvata in `%APPDATA%\EDON MDView\settings.json` e usata agli avvii successivi. Finché non si sceglie nulla il file non esiste e la lingua segue quella del sistema; eliminandolo si torna alla scelta automatica.

**Aiuto → Informazioni** mostra versione, licenza, il collegamento a [edon.systems](https://edon.systems) e i ringraziamenti ai principali progetti open source utilizzati, ciascuno con la propria licenza.

## Scorciatoie

| Azione | Tasti |
|---|---|
| Apri | `Ctrl+O` |
| Modifica documento | `Ctrl+E` |
| Salva / Salva con nome | `Ctrl+S` / `Ctrl+Maiusc+S` |
| Cerca | `Ctrl+F` |
| Risultato successivo / precedente | `F3` / `Maiusc+F3` |
| Ricarica | `F5` |
| Mostra/nascondi indice | `Ctrl+\` |
| Cambia tema | `Ctrl+Maiusc+T` |
| Esporta HTML | `Ctrl+Maiusc+E` |
| Stampa | `Ctrl+P` |
| Zoom | `Ctrl++`, `Ctrl+-`, `Ctrl+0` |

In modalità modifica:

| Azione | Tasti |
|---|---|
| Annulla / Ripeti | `Ctrl+Z` / `Ctrl+Y` |
| Grassetto, corsivo | `Ctrl+B`, `Ctrl+I` |
| Barrato, codice in linea | `Ctrl+Maiusc+X`, `Ctrl+Maiusc+C` |
| Collegamento | `Ctrl+K` |
| Titolo 1…6, paragrafo | `Ctrl+Alt+1`…`6`, `Ctrl+Alt+0` |
| Elenco puntato, numerato, di attività | `Ctrl+Maiusc+8`, `Ctrl+Maiusc+7`, `Ctrl+Maiusc+9` |
| Citazione, blocco di codice | `Ctrl+Maiusc+B`, `Ctrl+Alt+C` |
| Rientra / riduci una voce di elenco | `Tab` / `Maiusc+Tab` |
| A capo nella stessa riga | `Maiusc+Invio` |

Da riga di comando, dopo l'installazione:

```powershell
& "C:\percorso\installazione\EDON MDView.exe" "C:\percorso\documento.md"
```

## Riservatezza e sicurezza

EDON MDView non contiene telemetria e non invia i documenti a servizi esterni. Il rendering elimina script, moduli, iframe e gestori di eventi; i collegamenti HTTP si aprono nel browser predefinito. Le risorse locali sono limitate alla cartella del documento aperto. Anche in modifica il contenuto resta sanificato, e il salvataggio scrive soltanto sul file aperto o su quello scelto nella finestra **Salva con nome**. Un documento che contiene immagini remote può richiedere quelle immagini al relativo server.

I documenti e le singole immagini incorporate hanno un limite di 25 MB ciascuno. I file `.txt` possono essere aperti come testo Markdown.

## Licenza

EDON MDView è distribuito con **Functional Source License 1.1, MIT Future License**. La licenza consente uso, copia, modifica e ridistribuzione per scopi non concorrenti; ogni versione passa automaticamente alla licenza MIT al secondo anniversario della pubblicazione. Il testo completo è in [LICENSE](LICENSE) e viene mostrato anche dall'installer.

Copyright 2026 INFOTREND SRL.

## Sviluppo e verifica

Richiede Node.js 22 o successivo.

```powershell
npm ci
npm start       # compila e avvia l'app
npm test        # test unitari + finestra Electron reale
npm run dist    # genera installer e versione portabile in release/
```

Il progetto usa Electron, markdown-it, DOMPurify, highlight.js e, per la modifica visiva, Tiptap (ProseMirror); tutte le librerie sono incluse nell'app e funzionano senza rete. I test end-to-end usano una copia temporanea dei documenti di prova e un profilo separato (`EDON_MDVIEW_USER_DATA`): non modificano i file originali e non interferiscono con una copia dell'app già aperta.

I testi dell'interfaccia stanno solo nei due dizionari `src/i18n/it.js` e `src/i18n/en.js`, che devono avere le stesse chiavi (lo verifica un test); la pagina li richiama con gli attributi `data-i18n`. I test fissano la lingua con `EDON_MDVIEW_LANGUAGE`, che sostituisce quella del sistema, così il risultato non dipende dal computer su cui girano. L'elenco dei ringraziamenti è in `src/about.js`: un test controlla che ogni voce sia una dipendenza reale e che la licenza coincida con quella dichiarata dal pacchetto.
