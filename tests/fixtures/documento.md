# Guida Markdown

Benvenuto nel **documento di prova**. Questo testo verifica il rendering Markdown completo.

## Funzionalità

- [x] Apertura del documento
- [x] Indice automatico
- [ ] Lettura piacevole

| Funzione | Stato |
|---|---|
| Tabelle | Funzionante |
| Codice | Funzionante |

```js
const saluto = "Ciao, EDON MDView!";
console.log(saluto);
```

> Un visualizzatore deve rendere i contenuti chiari, senza distrarre.

![Logo locale](assets/test.svg)

[Apri il secondo documento](secondo.md)

## Funzionalità

Titolo ripetuto per verificare le ancore univoche. Una nota a piè di pagina.[^nota]

[^nota]: Le note sono supportate.

<script>window.__markdownXss = true;</script>
<img src="x" onerror="window.__markdownXss = true">
<a href="javascript:window.__markdownXss = true">Collegamento pericoloso</a>

### Ricerca

Questa sezione contiene una parola univoca: Serendipità.
