import { setLang } from '../i18n';

// Node exposes navigator.language from the OS locale; tests assert English text.
setLang('en');
