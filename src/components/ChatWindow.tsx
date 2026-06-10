import { useEffect, useRef } from 'react';
import type { Message } from '../types';
import { useT } from '../i18n';
import ChatBubble from './ChatBubble';
import styles from './ChatWindow.module.css';

interface Props {
  messages: Message[];
  loading: boolean;
}

export default function ChatWindow({ messages, loading }: Props) {
  const { t } = useT();
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // No need to scroll when there is no content
    if (messages.length === 0 && !loading) return;
    // Directly manipulate container scrollTop, only scroll ChatWindow internally
    // Avoid scrollIntoView scrolling all ancestors causing header to disappear
    const el = windowRef.current;
    if (!el) return;
    // Use instant during streaming to avoid jitter from stacked smooth animations; use smooth after
    el.scrollTo({ top: el.scrollHeight, behavior: loading ? 'instant' : 'smooth' });
  }, [messages, loading]);

  /**
   * Three-dot typing row only fills the "waiting for first token" gap.
   * Once the assistant bubble has any content (or its own activity sub-indicator),
   * the in-bubble streaming caret takes over the "still working" signal — so we
   * never end up with two stacked bot bubbles for the same in-flight turn.
   */
  const lastMsg = messages[messages.length - 1];
  const showTypingIndicator =
    loading && !(lastMsg?.role === 'assistant' && (lastMsg.content.length > 0 || lastMsg.activity));

  return (
    <div ref={windowRef} className={styles.window}>
      {messages.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⬡</span>
          <p className={styles.emptyTitle}>{t("empty.title")}</p>
          <p className={styles.emptyHint}>
            {t("empty.hint")}
          </p>
          <p className={styles.emptyFeatures}>
            {t("empty.features")}
          </p>
        </div>
      )}

      {messages.map(msg => (
        <ChatBubble key={msg.id} message={msg} />
      ))}

      {showTypingIndicator && (
        <div className={styles.typingRow}>
          <div className={styles.avatar}>⬡</div>
          <div className={styles.typing}>
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
    </div>
  );
}
