# Coming from Notion or Obsidian

Your notes are already text. SharpMD brings them in as plain `.md` files, with the links and the images in place. It all happens in your browser and nothing is uploaded, unless you choose the cloud.

## From Notion

1. In Notion, export the workspace or a page as "Markdown and CSV". You get a `.zip`.
2. In **Settings** > **Tools**, turn on **Import to Markdown**.
3. With **Choose a file**, pick the `.zip`. You can also drop it on the window.
4. Choose where to put it, name the folder and click **Import**.

SharpMD fixes what Notion leaves crooked:

- It removes the 32 letter and number code that Notion adds to the end of every file and folder name.
- It fixes the links between pages and the images so they point to the new names.
- It turns each database into a note with its table. The title of each row links to its page.
- If Notion split the export into several `.zip` files inside the main one, it opens those too.

## From Obsidian

A vault is a folder. With **Import to Markdown** turned on, go to **Settings** > **Tools** and use **Choose a folder**. If you have it compressed, **Choose a file** opens its `.zip` too.

- Double bracket links (`[[note]]` and `[[note|text]]`) keep working in SharpMD and are left alone. So is the front matter.
- Embedded images (`![[photo.png]]`) become Markdown, which SharpMD draws. An embedded audio or PDF becomes a link.
- An embedded note becomes a link.
- The `.obsidian` folder and the trash are ignored.

## Where it ends up

Before importing you choose the destination:

| Destination | What happens |
|---|---|
| **In the open folder on disk** | Creates a new folder with the notes and the attachments. It never overwrites one that already exists. |
| **In this browser** | Saves only the notes. The attachments do not go in. |
| **In my cloud** | Follows the usual path for sending to the cloud: before uploading it tells you how many notes fit in your plan. Of the attachments, only images are uploaded. |

What cannot be fixed, such as a broken link or a missing attachment, the window reports before importing and leaves as it was.

> [!NOTE]
> Links and images are fixed, but a Notion database loses its views, its filters and its formulas. You keep the table with the values.

For the other formats, see [[export-and-import|Export and import]]. To upload the notes and share them, [[cloud-and-sharing|The cloud and sharing]].
