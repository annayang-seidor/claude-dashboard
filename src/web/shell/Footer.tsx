import { Icon } from '../Icon';
import { useI18n } from '../i18n';

export function Footer() {
  const { tRich } = useI18n();
  return (
    <footer className="ftr">
      <Icon name="heart" size={13} fill="var(--c-ops)" stroke="var(--c-ops)" />
      {tRich('footer.madeBy', { name: <span className="ftr__name">annayang</span> })}
      <span aria-hidden="true">·</span>
      {/* Clawd Sparkles icon by Icons8. Its free licence needs a visible link credit for the logo
       * and favicon (ADR 0051). */}
      {tRich('footer.iconCredit', {
        author: (
          <a
            className="ftr__link"
            target="_blank"
            rel="noopener noreferrer"
            href="https://icons8.com/icon/BF896lmupIAB/clawd-sparkles"
          >
            Icons8
          </a>
        ),
      })}
    </footer>
  );
}
