package io.gpxtoign.core.pdf

import java.io.ByteArrayOutputStream
import java.util.zip.Inflater
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PdfDocumentTest {

    private fun write(build: (PdfDocument) -> Unit): ByteArray {
        val out = ByteArrayOutputStream()
        writePdf(out, 595.276, 841.89, build)
        return out.toByteArray()
    }

    private fun latin1(bytes: ByteArray) = bytes.toString(Charsets.ISO_8859_1)

    /** Content streams are deflated, so page operators have to be inflated to be read. */
    private fun contentStreams(pdf: ByteArray): String {
        val text = latin1(pdf)
        val header = Regex("<< /Filter /FlateDecode /Length (\\d+) >>\nstream\n")
        return header.findAll(text).joinToString("\n") { match ->
            val start = match.range.last + 1
            val length = match.groupValues[1].toInt()
            val inflater = Inflater()
            inflater.setInput(pdf, start, length)
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (!inflater.finished()) {
                val n = inflater.inflate(buffer)
                if (n == 0) break
                out.write(buffer, 0, n)
            }
            inflater.end()
            latin1(out.toByteArray())
        }
    }

    @Test
    fun `produces a structurally valid single page document`() {
        val bytes = write { it.addPage { page -> page.text(50.0, 50.0, 10.0, "Page 1") } }
        val text = latin1(bytes)
        assertTrue(text.startsWith("%PDF-1.4"), "missing header")
        assertTrue(text.trimEnd().endsWith("%%EOF"), "missing trailer")
        assertTrue(text.contains("/Type /Catalog"))
        assertTrue(text.contains("/Type /Pages /Count 1"))
        assertTrue(text.contains("/MediaBox [0 0 595.2760 841.8900]"))
    }

    /** The whole point of the change: one file, every page inside it. */
    @Test
    fun `collects every page into one document`() {
        val bytes = write { document ->
            repeat(9) { index ->
                document.addPage { page -> page.text(10.0, 10.0, 8.0, "page $index") }
            }
        }
        val text = latin1(bytes)
        assertTrue(text.contains("/Type /Pages /Count 9"))
        assertEquals(9, Regex("/Type /Page /Parent").findAll(text).count())
        val kids = text.substringAfter("/Kids [").substringBefore("]").trim().split(" 0 R").size - 1
        assertEquals(9, kids)
    }

    /** A wrong xref table is the classic way a hand-rolled writer breaks silently. */
    @Test
    fun `every xref offset points at its own object header`() {
        val bytes = write { document ->
            repeat(3) { index ->
                document.addPage { page ->
                    page.drawJpeg(ByteArray(16) { it.toByte() }, 4, 4, 0.0, 0.0, 10.0, 10.0)
                    page.text(10.0, 10.0, 8.0, "page $index")
                }
            }
        }
        val text = latin1(bytes)
        // "startxref" also ends in "xref", so anchor on the newline before the table.
        val xrefAt = text.lastIndexOf("\nxref\n") + 1
        val startXref = text.substringAfterLast("startxref\n").substringBefore("\n").trim().toInt()
        assertEquals(xrefAt, startXref, "startxref does not point at the xref table")

        val lines = text.substring(xrefAt).lines()
        val count = lines[1].trim().split(" ")[1].toInt()
        // Two fonts, the tree, the catalogue, then image + content + dictionary per page,
        // plus the mandatory free entry at number 0.
        assertEquals(4 + 3 * 3 + 1, count, "unexpected object count")
        for (index in 1 until count) {
            val offset = lines[2 + index].substring(0, 10).toInt()
            assertTrue(
                text.startsWith("$index 0 obj", offset),
                "object $index: xref says $offset, found '${text.substring(offset, offset + 12)}'",
            )
        }
        assertTrue(text.contains("/Size $count"))
    }

    /** Pages name their parent before the tree exists, so the reserved number must hold. */
    @Test
    fun `pages point at the page tree that is written after them`() {
        val bytes = write { document ->
            repeat(2) { document.addPage { page -> page.text(0.0, 0.0, 8.0, "x") } }
        }
        val text = latin1(bytes)
        val parent = Regex("/Parent (\\d+) 0 R").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(setOf("3"), parent)
        assertTrue(text.contains("3 0 obj\n<< /Type /Pages"))
        assertTrue(text.contains("/Root 4 0 R"))
    }

    @Test
    fun `jpeg payloads are embedded untouched as DCTDecode streams`() {
        val jpeg = ByteArray(64) { (it * 7).toByte() }
        val bytes = write { it.addPage { page -> page.drawJpeg(jpeg, 8, 8, 0.0, 0.0, 100.0, 100.0) } }
        val text = latin1(bytes)
        assertTrue(text.contains("/Subtype /Image /Width 8 /Height 8"))
        assertTrue(text.contains("/Filter /DCTDecode /Length 64"))
        assertTrue(latin1(jpeg) in text, "the jpeg bytes were altered")
        assertTrue(contentStreams(bytes).contains("100.0000 0 0 100.0000 0.0000 0.0000 cm /Im0 Do"))
    }

    @Test
    fun `parentheses and backslashes in labels are escaped`() {
        val bytes = write { it.addPage { page -> page.text(0.0, 0.0, 8.0, "a(b)c\\d") } }
        assertTrue(contentStreams(bytes).contains("(a\\(b\\)c\\\\d) Tj"))
    }

    /** WinAnsi, not Latin-1: the attribution line's em dash lives at 0x97. */
    @Test
    fun `typographic punctuation is transcoded to WinAnsi`() {
        val bytes = write {
            it.addPage { page -> page.text(0.0, 0.0, 8.0, "© IGN — SCAN25®") }
        }
        val expected = "(© IGN " + 0x97.toChar() + " SCAN25®) Tj"
        assertTrue(contentStreams(bytes).contains(expected), "em dash was not transcoded to WinAnsi")
    }

    @Test
    fun `content streams are deflated`() {
        val bytes = write { document ->
            document.addPage { page ->
                repeat(40) { page.text(10.0, it.toDouble(), 8.0, "un libelle assez repetitif") }
            }
        }
        val compressed = Regex("<< /Filter /FlateDecode /Length (\\d+) >>")
            .find(latin1(bytes))!!.groupValues[1].toInt()
        val plain = contentStreams(bytes).length
        assertTrue(compressed < plain / 2, "content stream barely shrank: $compressed vs $plain")
    }

    @Test
    fun `text width uses the real Helvetica metrics`() {
        var widths: PdfPage? = null
        write { it.addPage { page -> widths = page } }
        val page = widths!!
        // Every Helvetica digit is 556/1000 em.
        assertEquals(4 * 0.556 * 10.0, page.textWidth("1234", 10.0), 1e-9)
        assertTrue(page.textWidth("iii", 10.0) < page.textWidth("WWW", 10.0))
        assertTrue(page.textWidth("Page", 10.0, bold = true) > page.textWidth("Page", 10.0))
    }
}
