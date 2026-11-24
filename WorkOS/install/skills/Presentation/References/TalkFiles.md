# Talk files

A talk file the speaker hands over is Markdown, and its Markdown structure is the structure of the talk. Every intent that reads a talk file follows these rules (Write turns it into a `SCRIPT.md` by them):

| In the file | In the talk |
|-------------|-------------|
| A heading (`#` to `######`) | Starts a new talking point. Its text is that point's first slide title, used exactly as written. A level-1 heading also names the talk when no `--title` is given. A heading with nothing spoken under it (a part heading) gives no slides; it frames the points nested beneath it. |
| A line of one to three dashes | Also starts a new talking point, with no title of its own. |
| A line starting with `>` | A direction for what to show: graphics, animation, art, video, a GIF, footage of a real thing. Never spoken, never in the notes. It goes to that talking point's designer. |
| A line wholly in parentheses | A stage note. Never spoken; treated as a direction. |
| Any other line | Presenter notes, read aloud word for word, one sentence per line. |

When the speaker provides a title, it is used. Everything they did not provide (a talking point's subtitle, the titles and subtitles of its later slides, every title in an untitled point) is written by the designer, consistent with the headings around it. To change a provided title for good, edit the heading in the talk file.

The talk file (`SCRIPT.md`, or the speaker's Markdown it was written from) is the source, and the deck is regenerated from it. Edits made through an HTML template's in-place editor are lost on the next build, so lasting changes go in the talk file.
