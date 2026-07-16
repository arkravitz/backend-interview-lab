import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * A light palette for Python source.
 *
 * CodeMirror's stock light theme maps every keyword, control keyword and
 * operator keyword to one saturated magenta, and renders docstrings in the
 * same red as any other string. That reads as a toy next to `oneDark`, which
 * the dark mode already uses, so light mode gets a deliberate palette that
 * differentiates the roles a reader actually scans for.
 *
 * Hues follow `oneDark` so both themes describe the same token with the same
 * colour, which is what makes the two modes feel like one product.
 */
export const pythonLightHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#5f6875', fontStyle: 'italic' },
  // Docstrings first: they are strings, but a reader scans for prose, and
  // stock CodeMirror paints them in the same alarm red as any other literal.
  { tag: t.docString, color: '#4f6a54', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#a83c32' },
  { tag: t.number, color: '#1f7a4d' },
  { tag: t.bool, color: '#1f7a4d' },
  { tag: t.null, color: '#1f7a4d' },
  { tag: t.keyword, color: '#a3267a' },
  { tag: t.controlKeyword, color: '#a3267a' },
  { tag: t.moduleKeyword, color: '#a3267a' },
  // `self` and `cls` are the two names a reader looks for first in a method.
  {
    tag: [t.self, t.definition(t.variableName)],
    color: '#7a3ea8',
    fontStyle: 'italic',
  },
  { tag: t.function(t.variableName), color: '#1a5fb4' },
  { tag: t.function(t.propertyName), color: '#1a5fb4' },
  { tag: t.definition(t.variableName), color: '#1f2430' },
  { tag: t.variableName, color: '#1f2430' },
  { tag: t.propertyName, color: '#0f5c73' },
  { tag: t.definition(t.propertyName), color: '#0f5c73' },
  { tag: t.definition(t.typeName), color: '#8a5a00' },
  { tag: [t.typeName, t.className], color: '#8a5a00' },
  { tag: t.standard(t.variableName), color: '#0f5c73' },
  { tag: [t.operator, t.operatorKeyword], color: '#933f00' },
  { tag: t.punctuation, color: '#4f5768' },
  { tag: t.bracket, color: '#4f5768' },
  // Lezer emits escapes as `special(char)`, which would otherwise inherit the
  // string colour and make an escape indistinguishable from its text.
  { tag: t.special(t.character), color: '#a83c32' },
  { tag: t.invalid, color: '#b5443a' },
]);

export const lightHighlighting = syntaxHighlighting(pythonLightHighlight);
