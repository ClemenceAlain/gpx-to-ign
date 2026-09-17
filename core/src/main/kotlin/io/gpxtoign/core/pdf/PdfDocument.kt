package io.gpxtoign.core.pdf

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.zip.Deflater
import java.util.Locale

/**
 * A deliberately small PDF 1.4 writer.
 *
 * It exists instead of a library because the two things this app needs — placing already
 * encoded JPEGs and drawing a handful of lines and labels — are a few hundred lines, and a
 * hand-rolled writer behaves identically on the JVM and on Android. JPEG bytes go in
 * untouched as `DCTDecode` streams, so the map is never recompressed.
 *
 * Pages are serialised the moment they are finished rather than collected first, so a
 * thirty-page map book never holds more than one page of raster in memory. Object numbers
 * are handed out up front and the cross-reference table is built from a number-to-offset
 * map, which is what lets the page tree carry number 3 while being written last: PDF puts
 * no constraint on the order objects appear in the file.
 */
class PdfDocument(
    private val out: OutputStream,
    private val widthPt: Double,
    private val heightPt: Double,
) {
    private val offsets = mutableMapOf<Int, Int>()
    private val pageRefs = mutableListOf<Int>()
    private var next = FIRST_FREE_NUMBER
    private var written = 0
    private var finished = false

    init {
        write("%PDF-1.4\n%âãÏÓ\n".toByteArray(Charsets.ISO_8859_1))
        writeObject(
            REGULAR_FONT,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        )
        writeObject(
            BOLD_FONT,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold " +
                "/Encoding /WinAnsiEncoding >>",
        )
    }

    val pageCount get() = pageRefs.size

    /** Draws one page and writes it out immediately. */
    fun addPage(draw: (PdfPage) -> Unit) {
        check(!finished) { "the document is already closed" }
        val page = PdfPage(widthPt, heightPt)
        draw(page)

        val imageRefs = page.images.map { image ->
            writeStream(
                allocate(),
                "/Type /XObject /Subtype /Image /Width ${image.widthPx} " +
                    "/Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 " +
                    "/Filter /DCTDecode",
                image.jpeg,
            )
        }
        val contentRef = writeStream(allocate(), "/Filter /FlateDecode", deflate(page.contentBytes()))
        val resources = buildString {
            append("<< /Font << /F1 $REGULAR_FONT 0 R /F2 $BOLD_FONT 0 R >>")
            if (imageRefs.isNotEmpty()) {
                append(" /XObject << ")
                imageRefs.forEachIndexed { index, ref -> append("/Im$index $ref 0 R ") }
                append(">>")
            }
            append(" /ProcSet [/PDF /Text /ImageC] >>")
        }
        val pageRef = allocate()
        writeObject(
            pageRef,
            "<< /Type /Page /Parent $PAGE_TREE 0 R " +
                "/MediaBox [0 0 ${fmt(widthPt)} ${fmt(heightPt)}] " +
                "/Resources $resources /Contents $contentRef 0 R >>",
        )
        pageRefs.add(pageRef)
    }

    /** Writes the page tree, the catalogue and the cross-reference table. */
    fun finish() {
        check(!finished) { "the document is already closed" }
        check(pageRefs.isNotEmpty()) { "a PDF needs at least one page" }
        finished = true

        writeObject(
            PAGE_TREE,
            "<< /Type /Pages /Count ${pageRefs.size} /Kids [" +
                pageRefs.joinToString(" ") { "$it 0 R" } + "] >>",
        )
        writeObject(CATALOG, "<< /Type /Catalog /Pages $PAGE_TREE 0 R >>")

        val size = next
        val xref = written
        write("xref\n0 $size\n".toByteArray(Charsets.ISO_8859_1))
        write("0000000000 65535 f \n".toByteArray(Charsets.ISO_8859_1))
        for (number in 1 until size) {
            val offset = offsets[number] ?: 0
            write("%010d 00000 n \n".format(Locale.ROOT, offset).toByteArray(Charsets.ISO_8859_1))
        }
        write(
            (
                "trailer\n<< /Size $size /Root $CATALOG 0 R >>\n" +
                    "startxref\n$xref\n%%EOF\n"
                ).toByteArray(Charsets.ISO_8859_1),
        )
        out.flush()
    }

    private fun allocate(): Int = next++

    private fun writeObject(number: Int, body: String) {
        offsets[number] = written
        write("$number 0 obj\n".toByteArray(Charsets.ISO_8859_1))
        write(body.toByteArray(Charsets.ISO_8859_1))
        write("\nendobj\n".toByteArray(Charsets.ISO_8859_1))
    }

    private fun writeStream(number: Int, dictionary: String?, payload: ByteArray): Int {
        offsets[number] = written
        write("$number 0 obj\n".toByteArray(Charsets.ISO_8859_1))
        val head = if (dictionary == null) {
            "<< /Length ${payload.size} >>\nstream\n"
        } else {
            "<< $dictionary /Length ${payload.size} >>\nstream\n"
        }
        write(head.toByteArray(Charsets.ISO_8859_1))
        write(payload)
        write("\nendstream\nendobj\n".toByteArray(Charsets.ISO_8859_1))
        return number
    }

    /** Vector operators are plain ASCII and shrink by roughly four to one. */
    private fun deflate(bytes: ByteArray): ByteArray {
        val deflater = Deflater(Deflater.BEST_COMPRESSION)
        return try {
            deflater.setInput(bytes)
            deflater.finish()
            val out = ByteArrayOutputStream(bytes.size / 2 + 32)
            val buffer = ByteArray(8192)
            while (!deflater.finished()) {
                out.write(buffer, 0, deflater.deflate(buffer))
            }
            out.toByteArray()
        } finally {
            deflater.end()
        }
    }

    private fun write(bytes: ByteArray) {
        out.write(bytes)
        written += bytes.size
    }

    internal companion object {
        // Reserved so pages can name their parent and their fonts before either is written.
        const val REGULAR_FONT = 1
        const val BOLD_FONT = 2
        const val PAGE_TREE = 3
        const val CATALOG = 4
        const val FIRST_FREE_NUMBER = 5

        fun fmt(value: Double): String = "%.4f".format(Locale.ROOT, value)
    }
}

/** Convenience for the common case: build a whole document against a stream. */
inline fun writePdf(
    out: OutputStream,
    widthPt: Double,
    heightPt: Double,
    build: (PdfDocument) -> Unit,
) {
    val document = PdfDocument(out, widthPt, heightPt)
    build(document)
    document.finish()
}
