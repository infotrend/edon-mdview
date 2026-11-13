# EDON MDView

Visualizzatore Markdown desktop per Windows 10 e 11 (64 bit), con interfaccia in italiano e funzionamento locale.

**Sviluppatore:** INFOTREND SRL  
**Licenza:** [FSL-1.1-MIT](LICENSE)

## Perchè

Non trovavo un md viewer decente ed abbiamo deciso di farlo: lo abbiamo condiviso sperando possa essere utile anche ad altri.

## Avvio

### Installazione consigliata

1. Scarica e apri [EDON MDView Setup](https://github.com/infotrend/edon-mdview/releases/latest/download/EDON-MDView-Setup-1.0.1-x64.exe).
2. Leggi e accetta la licenza nel programma di installazione; non sono necessari privilegi di amministratore.
3. Avvia **EDON MDView** dal menu Start o dal collegamento sul desktop.

L'installazione registra EDON MDView come visualizzatore per `.md`, `.markdown`, `.mdown` e `.mkd`. Puoi scegliere EDON MDView dal menu **Apri con** di Windows.

### Versione portabile

Scarica e apri [EDON MDView Portable](https://github.com/infotrend/edon-mdview/releases/latest/download/EDON-MDView-Portable-1.0.1-x64.exe). Non richiede installazione; può essere copiata ed eseguita da una cartella o un'unità USB.

Gli eseguibili includono tutto il necessario: Node.js non deve essere installato. Non essendo firmati con un certificato commerciale, Windows SmartScreen potrebbe chiedere una conferma esplicita.

## Funzioni

- Apertura tramite menu, trascinamento o riga di comando.
- Rendering di titoli, tabelle, elenchi, attività, note, citazioni, collegamenti e codice evidenziato.
- Indice navigabile e ricerca con risultati evidenziati.
- Temi chiaro e scuro, zoom e impostazioni persistenti.
- Ricaricamento automatico quando il file viene salvato da un editor.
- Apertura di collegamenti ad altri documenti Markdown locali.
- Immagini locali e remote; quelle locali vengono incorporate nell'HTML esportato.
- Esportazione HTML autonoma e stampa, anche in PDF tramite la finestra di stampa di Windows.
- Elenco dei file recenti e associazione alle estensioni Markdown.

## Scorciatoie

| Azione | Tasti |
|---|---|
| Apri | `Ctrl+O` |
| Cerca | `Ctrl+F` |
| Risultato successivo / precedente | `F3` / `Maiusc+F3` |
| Ricarica | `F5` |
| Mostra/nascondi indice | `Ctrl+\` |
| Cambia tema | `Ctrl+Maiusc+T` |
| Esporta HTML | `Ctrl+Maiusc+E` |
| Stampa | `Ctrl+P` |
| Zoom | `Ctrl++`, `Ctrl+-`, `Ctrl+0` |

Da riga di comando, dopo l'installazione:

```powershell
& "C:\percorso\installazione\EDON MDView.exe" "C:\percorso\documento.md"
```

## Riservatezza e sicurezza

EDON MDView non contiene telemetria e non invia i documenti a servizi esterni. Il rendering elimina script, moduli, iframe e gestori di eventi; i collegamenti HTTP si aprono nel browser predefinito. Le risorse locali sono limitate alla cartella del documento aperto. Un documento che contiene immagini remote può richiedere quelle immagini al relativo server.

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

Il progetto usa Electron, markdown-it, DOMPurify e highlight.js. I test end-to-end usano una copia temporanea dei documenti di prova e non modificano i file originali.
