package io.gpxtoign.core.pdf

import java.io.ByteArrayOutputStream
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PdfDocumentTest {

    private fun write(build: (PdfDocument) -> Unit): ByteArray {
        val document = PdfDocument(595.276, 841.89)
        build(document)
        return ByteArrayOutputStream().also { document.writeTo(it) }.toByteArray()
    }

    private fun latin1(bytes: ByteArray) = bytes.toString(Charsets.ISO_8859_1)

    @Test
    fun `produces a structurally valid single page document`() {
        val bytes = write { it.addPage().text(50.0, 50.0, 10.0, "Page 1") }
        val text = latin1(bytes)
        assertTrue(text.startsWith("%PDF-1.4"), "missing header")
        assertTrue(text.trimEnd().endsWith("%%EOF"), "missing trailer")
        assertTrue(text.contains("/Type /Catalog"))
        assertTrue(text.contains("/Type /Pages /Count 1"))
        assertTrue(text.contains("/MediaBox [0 0 595.2760 841.8900]"))
    }

    /** A wrong xref table is the classic way a hand-rolled writer breaks silently. */
    @Test
    fun `every xref offset points at its own object header`() {
        val bytes = write { document ->
            repeat(3) { index -> document.addPage().text(10.0, 10.0, 8.0, "page $index") }
        }
        val text = latin1(bytes)
        // "startxref" also ends in "xref", so anchor on the newline before the table.
        val xrefAt = text.lastIndexOf("\nxref\n") + 1
        val startXref = text.substringAfterLast("startxref\n").substringBefore("\n").trim().toInt()
        assertEquals(xrefAt, startXref, "startxref does not point at the xref table")

        val lines = text.substring(xrefAt).lines()
        val count = lines[1].trim().split(" ")[1].toInt()
        for (index in 1 until count) {
            val offset = lines[2 + index].substring(0, 10).toInt()
            assertTrue(
                text.startsWith("$index 0 obj", offset),
                "object $index: xref says $offset, found '${text.substring(offset, offset + 12)}'",
            )
        }
        assertTrue(text.contains("/Size $count"))
    }

    @Test
    fun `jpeg payloads are embedded untouched as DCTDecode streams`() {
        val jpeg = ByteArray(64) { (it * 7).toByte() }
        val bytes = write { it.addPage().drawJpeg(jpeg, 8, 8, 0.0, 0.0, 100.0, 100.0) }
        val text = latin1(bytes)
        assertTrue(text.contains("/Subtype /Image /Width 8 /Height 8"))
        assertTrue(text.contains("/Filter /DCTDecode /Length 64"))
        assertTrue(latin1(jpeg) in text, "the jpeg bytes were altered")
        assertTrue(text.contains("100.0000 0 0 100.0000 0.0000 0.0000 cm /Im0 Do"))
    }

    @Test
    fun `parentheses and backslashes in labels are escaped`() {
        val bytes = write { it.addPage().text(0.0, 0.0, 8.0, "a(b)c\\d") }
        assertTrue(latin1(bytes).contains("(a\\(b\\)c\\\\d) Tj"))
    }

    /** WinAnsi, not Latin-1: the attribution line's em dash lives at 0x97. */
    @Test
    fun `typographic punctuation is transcoded to WinAnsi`() {
        val bytes = write { it.addPage().text(0.0, 0.0, 8.0, "© IGN — SCAN25®") }
        val expected = "(© IGN " + 0x97.toChar() + " SCAN25®) Tj"
        assertTrue(latin1(bytes).contains(expected), "em dash was not transcoded to WinAnsi")
    }

    @Test
    fun `text width uses the real Helvetica metrics`() {
        val page = PdfDocument(100.0, 100.0).addPage()
        // Every Helvetica digit is 556/1000 em.
        assertEquals(4 * 0.556 * 10.0, page.textWidth("1234", 10.0), 1e-9)
        assertTrue(page.textWidth("iii", 10.0) < page.textWidth("WWW", 10.0))
        assertTrue(page.textWidth("Page", 10.0, bold = true) > page.textWidth("Page", 10.0))
    }
}
