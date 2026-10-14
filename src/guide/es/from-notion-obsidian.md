# Venís de Notion u Obsidian

Tus notas ya son texto. SharpMD las trae como archivos `.md` comunes, con los enlaces y las imágenes en su lugar. Todo pasa en tu navegador y no se sube nada, salvo que elijas la nube.

## Desde Notion

1. En Notion, exportá el espacio o una página como "Markdown y CSV". Te baja un `.zip`.
2. En **Ajustes** > **Herramientas**, prendé **Importar a Markdown**.
3. Con **Elegir un archivo**, elegí el `.zip`. También podés soltarlo en la ventana.
4. Elegí dónde dejarlo, ponele nombre a la carpeta y tocá **Importar**.

SharpMD arregla lo que Notion deja torcido:

- Quita el código de 32 letras y números que Notion agrega al final de cada nombre de archivo y de carpeta.
- Corrige los enlaces entre páginas y las imágenes para que apunten a los nombres nuevos.
- Convierte cada base de datos en una nota con su tabla. El título de cada fila enlaza a su página.
- Si Notion partió la exportación en varios `.zip` adentro del principal, también los abre.

## Desde Obsidian

Una bóveda es una carpeta. Con **Importar a Markdown** prendido, andá a **Ajustes** > **Herramientas** y usá **Elegir una carpeta**. Si la tenés comprimida, **Elegir un archivo** también abre su `.zip`.

- Los enlaces con corchetes dobles (`[[nota]]` y `[[nota|texto]]`) siguen andando en SharpMD y no se tocan. Tampoco el front matter.
- Las imágenes incrustadas (`![[foto.png]]`) pasan a Markdown, que SharpMD dibuja. Un audio o un PDF incrustado queda como enlace.
- Una nota incrustada queda como enlace.
- La carpeta `.obsidian` y la papelera se ignoran.

## Dónde queda

Antes de importar elegís el destino:

| Destino | Qué pasa |
|---|---|
| **En la carpeta abierta del disco** | Crea una carpeta nueva con las notas y los adjuntos. Nunca pisa una que ya existe. |
| **En este navegador** | Guarda solo las notas. Los adjuntos no entran. |
| **En mi nube** | Sigue el recorrido de siempre para enviar a la nube: antes de subir te dice cuántas notas entran en tu plan. De los adjuntos, suben solo las imágenes. |

Lo que no se puede arreglar, como un enlace roto o un adjunto que falta, la ventana lo cuenta antes de importar y lo deja como estaba.

> [!NOTE]
> Los enlaces y las imágenes se arreglan, pero una base de datos de Notion pierde sus vistas, sus filtros y sus fórmulas. Queda la tabla con los valores.

Para el resto de los formatos, mirá [[export-and-import|Exportar e importar]]. Para subir las notas y compartirlas, [[cloud-and-sharing|La nube y compartir]].
