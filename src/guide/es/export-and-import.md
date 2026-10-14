# Exportar e importar

## Llevarte una nota

El botón **Exportar** de la barra de arriba ofrece:

| Opción | Qué sale |
|---|---|
| **PDF** | La nota por el diálogo de impresión del navegador |
| **Archivo HTML** | Un solo archivo que se abre en cualquier navegador |
| **Archivo Markdown (.md)** | El texto de la nota |
| **Imprimir** | Lo mismo que `Ctrl+P` |

El botón **Copiar** copia la nota como **Markdown**, **Texto con formato** o **HTML**. El texto con formato se pega bien en un correo o en un documento.

Word (.docx) está siempre en el menú Exportar, sin prender nada. El archivo se arma en tu navegador, con los títulos, las listas, las tablas, el código y las imágenes. Las fórmulas van como ecuaciones de Word que se pueden editar, y los diagramas, como imágenes.

## Una carpeta entera

En el explorador, el clic derecho sobre una carpeta ofrece **Exportar la carpeta…**. Junta todas sus notas en un solo documento, una después de la otra: PDF, HTML, Word, un libro EPUB o un único Markdown. Los enlaces entre las notas pasan a ser internos, y podés sumar una tapa y un índice. En el EPUB cada nota es un capítulo, en el orden de la carpeta, con índice, título y autor (se toma del encabezado de las notas o lo escribís vos) y las imágenes adentro. Si Word o el EPUB no se pueden armar, te lo avisa en vez de entregar otro formato.

El clic derecho sobre una carpeta también ofrece **Palabras de la carpeta…**: el total, las palabras de cada nota y una meta opcional con su barra de avance. La meta queda guardada en este navegador.

## Toda tu nube

En **Ajustes** > **Nube**, el botón **Descargar todas mis notas** arma en tu navegador un ZIP con todo lo que tenés en la nube, con las mismas carpetas. Los tableros viajan dentro de sus notas, y las imágenes van en una carpeta `_images/` con las direcciones ya apuntando ahí.

Las carpetas protegidas con contraseña salen descifradas, pero solo si están desbloqueadas: la descifra tu navegador y la llave nunca sale de él. Si alguna sigue bloqueada, el botón te ofrece desbloquearla o seguir sin ella; lo que queda afuera se lista en `_not-included.txt` dentro del ZIP. Si tenés un equipo, podés sumar sus notas en una subcarpeta `@team/`.

Al eliminar la cuenta, el primer paso ofrece esta misma descarga.

## Traer otros formatos

La herramienta **Importar a Markdown** convierte un archivo en una nota:

- Word (.docx), Excel (.xlsx) y PowerPoint (.pptx)
- EPUB y PDF
- HTML, CSV y TSV

Todo pasa en tu navegador y no se sube nada. El resultado se abre como una nota nueva sin guardar, o va al final de la nota abierta.

> [!NOTE]
> De un PDF sale solo el texto, página por página. No hay reconocimiento de texto en imágenes.

Las dos herramientas se prenden en **Ajustes** > **Herramientas**. Están en [Herramientas y plugins](tools-and-plugins.md).

## Tus archivos siguen siendo tuyos

Una nota es un archivo `.md`. Lo que escribís en una carpeta del disco ya está ahí, sin exportar nada. Una nota del navegador se guarda como archivo con `Ctrl+S`.
