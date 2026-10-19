# Notezy

Notezy is a floating wall for sharing short public thoughts. Search and filter notes, then open them to like or reply.

## Run

Install Node.js 18 or newer, then run:

```sh
npm start
```

Open <http://localhost:4173> in your browser. The built-in server stores shared notes in `data/notes.json` and streams live updates to connected visitors.

You can also open `index.html` directly. That uses browser storage, so notes stay local to that browser and are not shared.

The project uses plain HTML, CSS, and JavaScript with no runtime package dependencies.
