package io.gpxtoign.core.pdf

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.util.Locale

/**
 * A deliberately small PDF 1.4 writer.
 *
 * It exists instead of a library because the two things this app needs — placing already
 * encoded JPEGs and drawing a handful of lines and labels — are a few hundred lines, and a
 * hand-rolled writer behaves identically on the JVM and on Android. JPEG bytes go in
 * untouched as `DCTDecode` streams, so the map is never recompressed.
 */
class PdfDocument(private val widthPt: Double, private val heightPt: Double) {

    private val pages = mutableListOf<PdfPage>()

    fun addPage(): PdfPage = PdfPage(widthPt, heightPt).also { pages.add(it) }

    val pageCount get() = pages.size

    fun writeTo(out: OutputStream) {
        val objects = mutableListOf<ByteArray>()
        fun add(body: ByteArray): Int { objects.add(body); return objects.size }

        // 1 catalog, 2 page tree, 3/4 the two base-14 fonts we use.
        add(ByteArray(0))
        add(ByteArray(0))
        val regularFont = add(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .toByteArray(Charsets.ISO_8859_1),
        )
        val boldFont = add(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
                .toByteArray(Charsets.ISO_8859_1),
        )

        val pageRefs = mutableListOf<Int>()
        for (page in pages) {
            val imageRefs = page.images.map { image ->
                val header = buildString {
                    append("<< /Type /XObject /Subtype /Image")
                    append(" /Width ").append(image.widthPx)
                    append(" /Height ").append(image.heightPx)
                    append(" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode")
                    append(" /Length ").append(image.jpeg.size)
                    append(" >>\nstream\n")
                }
                add(header.toByteArray(Charsets.ISO_8859_1) + image.jpeg + "\nendstream".toByteArray())
            }
            val content = page.contentBytes()
            val contentRef = add(
                "<< /Length ${content.size} >>\nstream\n".toByteArray(Charsets.ISO_8859_1) +
                    content + "\nendstream".toByteArray(),
            )
            val resources = buildString {
                append("<< /Font << /F1 $regularFont 0 R /F2 $boldFont 0 R >>")
                if (imageRefs.isNotEmpty()) {
                    append(" /XObject << ")
                    imageRefs.forEachIndexed { i, ref -> append("/Im$i $ref 0 R ") }
                    append(">>")
                }
                append(" /ProcSet [/PDF /Text /ImageC] >>")
            }
            pageRefs.add(
                add(
                    ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
                        "${fmt(widthPt)} ${fmt(heightPt)}] /Resources $resources " +
                        "/Contents $contentRef 0 R >>").toByteArray(Charsets.ISO_8859_1),
                ),
            )
        }

        objects[0] = "<< /Type /Catalog /Pages 2 0 R >>".toByteArray(Charsets.ISO_8859_1)
        objects[1] = ("<< /Type /Pages /Count ${pageRefs.size} /Kids [" +
            pageRefs.joinToString(" ") { "$it 0 R" } + "] >>").toByteArray(Charsets.ISO_8859_1)

        val buffer = ByteArrayOutputStream()
        buffer.write("%PDF-1.4\n%âãÏÓ\n".toByteArray(Charsets.ISO_8859_1))
        val offsets = IntArray(objects.size + 1)
        objects.forEachIndexed { index, body ->
            offsets[index + 1] = buffer.size()
            buffer.write("${index + 1} 0 obj\n".toByteArray(Charsets.ISO_8859_1))
            buffer.write(body)
            buffer.write("\nendobj\n".toByteArray(Charsets.ISO_8859_1))
        }
        val xref = buffer.size()
        buffer.write("xref\n0 ${objects.size + 1}\n".toByteArray(Charsets.ISO_8859_1))
        buffer.write("0000000000 65535 f \n".toByteArray(Charsets.ISO_8859_1))
        for (index in 1..objects.size) {
            buffer.write(
                "%010d 00000 n \n".format(Locale.ROOT, offsets[index])
                    .toByteArray(Charsets.ISO_8859_1),
            )
        }
        buffer.write(
            ("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
                .toByteArray(Charsets.ISO_8859_1),
        )
        out.write(buffer.toByteArray())
    }

    internal companion object {
        fun fmt(value: Double): String = "%.4f".format(Locale.ROOT, value)
    }
}
