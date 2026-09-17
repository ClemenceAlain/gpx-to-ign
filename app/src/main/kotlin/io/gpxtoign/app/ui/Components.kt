package io.gpxtoign.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Section caption above a grouped card: small, upper case, muted. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
    Text(
        text = title.uppercase(),
        style = AppText.footnote,
        color = LocalAppColors.current.secondaryLabel,
        modifier = modifier.padding(start = 32.dp, end = 32.dp, top = 24.dp, bottom = 7.dp),
    )
}

/** The inset rounded card an iOS grouped list is built from. */
@Composable
fun Section(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(LocalAppColors.current.card),
    ) {
        content()
    }
}

/** Hairline between rows, inset so it starts under the label rather than the card edge. */
@Composable
fun RowSeparator(inset: Boolean = true) {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = if (inset) 16.dp else 0.dp)
            .height(0.5.dp)
            .background(LocalAppColors.current.separator),
    )
}

/**
 * A grouped-list row: label on the left, whatever the caller supplies on the right.
 *
 * The 44 dp minimum is Apple's touch target, and it is what keeps a list of mixed rows
 * looking evenly spaced.
 */
@Composable
fun SettingsRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    titleColor: Color? = null,
    onClick: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val colors = LocalAppColors.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .defaultMinSize(minHeight = 44.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = AppText.body, color = titleColor ?: colors.label)
            subtitle?.let {
                Text(it, style = AppText.footnote, color = colors.secondaryLabel)
            }
        }
        trailing()
    }
}

/** Explanatory text under a card, the way iOS Settings annotates a toggle. */
@Composable
fun SectionFootnote(text: String) {
    Text(
        text = text,
        style = AppText.footnote,
        color = LocalAppColors.current.secondaryLabel,
        modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 7.dp),
    )
}

/** Full-width filled call to action. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = LocalAppColors.current
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (enabled) colors.accent else colors.fill)
            .clickable(enabled = enabled, onClick = onClick)
            .defaultMinSize(minHeight = 50.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = AppText.headline,
            color = if (enabled) Color.White else colors.tertiaryLabel,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
        )
    }
}

/** iOS segmented control: a pill of equal segments with the selected one raised. */
@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalAppColors.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(colors.fill)
            .padding(2.dp),
    ) {
        options.forEachIndexed { index, option ->
            val selected = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (selected) colors.card else Color.Transparent)
                    .clickable { onSelect(index) }
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    option,
                    style = if (selected) AppText.subheadline.copy(
                        fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                    ) else AppText.subheadline,
                    color = colors.label,
                    maxLines = 1,
                )
            }
        }
    }
}

/** The muted chevron that marks a row as opening something. */
@Composable
fun Chevron(expanded: Boolean = false) {
    Text(
        text = if (expanded) "⌄" else "›",
        style = AppText.body,
        color = LocalAppColors.current.tertiaryLabel,
    )
}

/** Large figure with a caption under it, for the plan summary. */
@Composable
fun Figure(value: String, caption: String, modifier: Modifier = Modifier, color: Color? = null) {
    val colors = LocalAppColors.current
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = AppText.figure, color = color ?: colors.accent)
        Text(caption, style = AppText.footnote, color = colors.secondaryLabel)
    }
}

/** Padding used between the stacked sections of the screen. */
val ScreenPadding = PaddingValues(bottom = 40.dp)

/** iOS Settings text entry: label on the left, the value typed flush right. */
@Composable
fun TextFieldRow(
    title: String,
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalAppColors.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 44.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = AppText.body, color = colors.label)
        Box(Modifier.weight(1f).padding(start = 16.dp), contentAlignment = Alignment.CenterEnd) {
            androidx.compose.foundation.text.BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = AppText.body.copy(
                    color = colors.secondaryLabel,
                    textAlign = TextAlign.End,
                ),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.accent),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (value.isEmpty()) {
                        Text(
                            placeholder,
                            style = AppText.body,
                            color = colors.tertiaryLabel,
                            textAlign = TextAlign.End,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    inner()
                },
            )
        }
    }
}

/**
 * A slider drawn the iOS way: a 4 dp continuous track and a white thumb that reads by its
 * shadow. Material's own track leaves a gap around the thumb and draws a small dot, which
 * looks wrong next to grouped rows.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun AppSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    modifier: Modifier = Modifier,
) {
    val colors = LocalAppColors.current
    val fraction = ((value - valueRange.start) / (valueRange.endInclusive - valueRange.start))
        .coerceIn(0f, 1f)
    androidx.compose.material3.Slider(
        value = value,
        onValueChange = onValueChange,
        valueRange = valueRange,
        modifier = modifier,
        thumb = {
            Box(
                Modifier
                    .size(28.dp)
                    .shadow(3.dp, androidx.compose.foundation.shape.CircleShape)
                    .background(Color.White, androidx.compose.foundation.shape.CircleShape),
            )
        },
        track = {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(colors.fill),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(4.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(colors.accent),
                )
            }
        },
    )
}
