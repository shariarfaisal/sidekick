import { getEditor, getMarkdown } from './editor.js';

const AI_ENDPOINT = 'http://localhost:8768/api/ai/chat';

const SYSTEM_PROMPTS = {
  rewrite: 'Rewrite the following text to improve clarity and readability. Keep the same meaning and tone. Return only the rewritten text, no explanation.',
  summarize: 'Summarize the following text concisely. Return only the summary, no explanation.',
  expand: 'Expand the following text with more detail and depth. Keep the same tone and style. Return only the expanded text, no explanation.',
  fixGrammar: 'Fix all grammar, spelling, and punctuation errors in the following text. Keep the meaning unchanged. Return only the corrected text, no explanation.',
};

/**
 * Stream chat completions from the AI proxy.
 * @param {Array} messages - OpenAI-format messages
 * @param {{ onToken: Function, onDone: Function, onError: Function }} callbacks
 * @returns {{ abort: Function }}
 */
export function streamChat(messages, { onToken, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        onError?.(new Error(err));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            onDone?.();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onToken?.(content);
          } catch {
            // skip unparseable lines
          }
        }
      }
      onDone?.();
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }
  })();

  return { abort: () => controller.abort() };
}

/**
 * Get the current note content as markdown for chat context.
 */
export function getNoteContext() {
  return getMarkdown() || '';
}

/**
 * Run an inline AI action on the current editor selection.
 * Shows a floating indicator while processing.
 */
export function runInlineAction(action) {
  const editor = getEditor();
  if (!editor) return;

  const { from, to } = editor.state.selection;
  if (from === to) return; // no selection

  const selectedText = editor.state.doc.textBetween(from, to, '\n');
  if (!selectedText.trim()) return;

  const systemPrompt = SYSTEM_PROMPTS[action];
  if (!systemPrompt) return;

  // Show loading indicator
  const indicator = document.createElement('div');
  indicator.className = 'ai-loading-indicator';
  indicator.textContent = 'AI thinking...';
  document.getElementById('app').appendChild(indicator);

  let result = '';

  streamChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: selectedText },
    ],
    {
      onToken(token) {
        result += token;
      },
      onDone() {
        indicator.remove();
        if (result.trim()) {
          // Replace selection with AI result
          editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result.trim()).run();
        }
      },
      onError(err) {
        indicator.remove();
        console.error('AI action error:', err);
      },
    }
  );
}
