import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ImageAttachment } from '../types';
import { useT } from '../i18n';
import styles from './ChatBubble.module.css';

interface Props {
  message: Message;
}

const TABLE_ROW_BOUNDARY = /\|\s+\|/g;
const TABLE_SEPARATOR_ROW = /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function normalizeCompactTableLine(line: string): string {
  if (!line.includes('| |')) return line;

  const pipeIndexes = [...line.matchAll(/\|/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  for (const index of pipeIndexes) {
    const table = line.slice(index);
    const normalizedTable = table.replace(TABLE_ROW_BOUNDARY, '|\n|');
    const rows = normalizedTable
      .split('\n')
      .map((row) => row.trim())
      .filter(Boolean);

    if (rows.length >= 2 && TABLE_SEPARATOR_ROW.test(rows[1])) {
      const prefix = line.slice(0, index).trimEnd();
      return prefix ? `${prefix}\n${normalizedTable}` : normalizedTable;
    }
  }

  return line;
}

function normalizeMarkdown(content: string): string {
  let inCodeFence = false;

  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      return inCodeFence ? line : normalizeCompactTableLine(line);
    })
    .join('\n');
}

/** Determine the image src for rendering. Supports both ImageAttachment and legacy base64 strings. */
function getImageSrc(img: ImageAttachment | string): string {
  if (typeof img === 'string') {
    // Legacy base64 string — render as data URI
    return `data:image/png;base64,${img}`;
  }
  // ImageAttachment — use blob: URL if available
  return img.url || '';
}

/** Get alt text for an image. */
function getImageAlt(img: ImageAttachment | string, idx: number): string {
  if (typeof img === 'string') {
    return `tool result ${idx + 1}`;
  }
  return `screenshot ${img.id.slice(0, 8)}`;
}

export default function ChatBubble({ message }: Props) {
  const { t, lang } = useT();
  const isUser = message.role === 'user';
  const content = isUser ? message.content : normalizeMarkdown(message.content);
  const images = message.images || [];
  const activity = message.activity;

  if (!isUser && !message.content && images.length === 0 && !activity) return null;

  return (
    <div className={`${styles.row} ${isUser ? styles.userRow : styles.botRow}`}>
      {!isUser && <div className={styles.avatar}>⬡</div>}
      <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.botBubble}`}>
        {!isUser && activity?.type === 'web_search' && (
          <div
            className={`${styles.webSearchActivity} ${
              activity.status === 'error' ? styles.webSearchError :
              activity.status === 'done'  ? styles.webSearchDone  :
                                            styles.webSearchActive
            }`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.searchGlyph} aria-hidden="true" />
            <span className={styles.searchLabel}>{
              activity.status === 'error' && activity.errorCode === 'wsa_missing'
                ? t('webSearch.error.wsaMissing')
                : activity.label
            }</span>
            {activity.status === 'error' ? (
              <>
                <span className={styles.searchErrorMark} aria-hidden="true">⚠️</span>
                {activity.errorCode === 'wsa_missing' && (
                  <a
                    className={styles.searchErrorCta}
                    href="https://cloud.tencent.com/product/wsa"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('webSearch.error.wsaCta')} →
                  </a>
                )}
              </>
            ) : (
              <span className={styles.searchDots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        )}
        {isUser
          ? content
          : content && (
              <div className={`${styles.markdown} ${message.streaming ? styles.markdownStreaming : ''}`}>
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </div>
            )
        }
        {images.length > 0 && (
          <div className={styles.imageList}>
            {images.map((img, idx) => {
              const src = getImageSrc(img);
              if (!src) return null;
              return (
                <img
                  key={typeof img === 'string' ? idx : img.id}
                  className={styles.image}
                  src={src}
                  alt={getImageAlt(img, idx)}
                />
              );
            })}
          </div>
        )}
        <span className={styles.time}>
          {new Date(message.timestamp).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && <div className={`${styles.avatar} ${styles.userAvatar}`}>U</div>}
    </div>
  );
}
