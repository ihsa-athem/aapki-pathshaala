/**
 * Strip markdown symbols from text before sending to TTS.
 * Claude sometimes uses markdown even when instructed not to.
 * Speaking "asterisk asterisk" or "hashtag hashtag" aloud is jarring.
 */
export function stripForTTS(text = '') {
  return text
    // timestamp badges [2:30] [2:30–3:15]
    .replace(/\[(\d+:\d+)[–\-]?(\d+:\d+)?\]/g, '')
    // headings  ## Heading
    .replace(/#{1,6}\s*/gm, '')
    // bold **text** and italic *text*
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    // underline _text_ __text__
    .replace(/_{1,2}(.+?)_{1,2}/gs, '$1')
    // strikethrough ~~text~~
    .replace(/~~(.+?)~~/gs, '$1')
    // inline code `text`
    .replace(/`([^`]+)`/g, '$1')
    // markdown links [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // bullet list markers - / * / +
    .replace(/^[-*+•]\s+/gm, '')
    // numbered list markers 1. 2.
    .replace(/^\d+\.\s+/gm, '')
    // blockquotes >
    .replace(/^>\s*/gm, '')
    // extra whitespace
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
