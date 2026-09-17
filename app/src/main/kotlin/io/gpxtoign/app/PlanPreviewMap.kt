package io.gpxtoign.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import io.gpxtoign.app.ui.AppText
import io.gpxtoign.app.ui.LocalAppColors
import io.gpxtoign.core.layout.PlanPreview
import kotlin.math.min

/** The red the printed overview page outlines its pages in, so both read the same. */
private val PageRed = Color(0xFFD91919)
private val PageWash = Color(0x14D91919)

/**
 * The page plan, drawn from the offline layout: page footprints numbered in walking order,
 * over the trace, with a north arrow for the rotation.
 *
 * There is no map underneath. Fetching one would mean downloading tiles before the user has
 * agreed to anything, which is exactly what the estimate above it exists to avoid.
 */
@Composable
fun PlanPreviewMap(preview: PlanPreview, modifier: Modifier = Modifier) {
    val colors = LocalAppColors.current
    val measurer = rememberTextMeasurer()
    val numberStyle = AppText.caption.copy(color = PageRed, fontWeight = FontWeight.Bold)
    val northStyle = AppText.caption.copy(color = colors.secondaryLabel)
    val bounds = preview.bounds
    // Follows the shape of the walk, within what still looks like a card on a phone.
    val ratio = (bounds.width / bounds.height).toFloat().coerceIn(0.75f, 1.6f)

    Canvas(
        modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .background(colors.fill),
    ) {
        val scale = min(size.width / bounds.width, size.height / bounds.height)
        val originX = (size.width - bounds.width * scale) / 2.0
        val originY = (size.height - bounds.height * scale) / 2.0
        fun px(u: Double) = (originX + (u - bounds.uMin) * scale).toFloat()
        // The page frame counts v upwards, the canvas counts y downwards.
        fun py(v: Double) = (originY + (bounds.vMax - v) * scale).toFloat()

        for (leg in preview.tracks) {
            if (leg.size < 2) continue
            val path = Path()
            path.moveTo(px(leg[0].u), py(leg[0].v))
            for (i in 1 until leg.size) path.lineTo(px(leg[i].u), py(leg[i].v))
            drawPath(
                path,
                color = colors.accent,
                style = Stroke(
                    width = 2.dp.toPx(),
                    cap = StrokeCap.Round,
                    join = StrokeJoin.Round,
                ),
            )
        }

        for (page in preview.pages) {
            val rect = page.rect
            val topLeft = Offset(px(rect.uMin), py(rect.vMax))
            val pageSize = Size(px(rect.uMax) - topLeft.x, py(rect.vMin) - topLeft.y)
            drawRect(PageWash, topLeft, pageSize)
            drawRect(PageRed, topLeft, pageSize, style = Stroke(1.5.dp.toPx()))

            val label = measurer.measure(page.number.toString(), numberStyle)
            val centre = Offset(topLeft.x + pageSize.width / 2, topLeft.y + pageSize.height / 2)
            val padX = 6.dp.toPx()
            val padY = 2.dp.toPx()
            drawRoundRect(
                color = Color.White,
                topLeft = Offset(
                    centre.x - label.size.width / 2 - padX,
                    centre.y - label.size.height / 2 - padY,
                ),
                size = Size(label.size.width + 2 * padX, label.size.height + 2 * padY),
                cornerRadius = CornerRadius(4.dp.toPx()),
            )
            drawText(
                label,
                topLeft = Offset(
                    centre.x - label.size.width / 2,
                    centre.y - label.size.height / 2,
                ),
            )
        }

        // North lives at a fixed angle here: the whole preview is drawn in the page frame.
        val arrow = 13.dp.toPx()
        val tail = Offset(size.width - 28.dp.toPx(), 34.dp.toPx())
        val tip = Offset(
            tail.x + (preview.north.u * arrow).toFloat(),
            tail.y - (preview.north.v * arrow).toFloat(),
        )
        drawLine(
            colors.secondaryLabel, tail, tip,
            strokeWidth = 1.5.dp.toPx(), cap = StrokeCap.Round,
        )
        drawCircle(colors.secondaryLabel, radius = 2.dp.toPx(), center = tail)
        val north = measurer.measure("N", northStyle)
        drawText(
            north,
            topLeft = Offset(
                tip.x - north.size.width / 2 + (preview.north.u * 7.dp.toPx()).toFloat(),
                tip.y - north.size.height / 2 - (preview.north.v * 7.dp.toPx()).toFloat(),
            ),
        )
    }
}
