/**
 * #1079 — every text the Web SDK draws itself, in the eight languages Onelo
 * translates into, drawn in the App's Page Language (`@onelo/core`
 * `page-language.ts`: the backend's `page_language` from `/api/sdk/config`,
 * #1074). The SDK never picks the language; it renders the answer.
 *
 * A developer's own content (app name, plan names, document names they
 * invented) is never here: it is shown as written. Log lines and messages
 * that address the developer stay English. The words are the hosted pages'
 * where a hosted page says the same thing, so the SDK and the page it opens
 * speak alike:
 * - signingIn: the Store's `signingIn` (frontend/lib/store-i18n.ts);
 * - signedIn: the sign-in pages' `signedInTitle` (sign-in-pages-i18n.ts);
 * - badgeComingSoon / badgeAvailableIn: hosted-notice-i18n.ts lockComingSoon /
 *   lockAvailableIn; badgeUpgrade: store-i18n.ts changePlan;
 * - consent gate: the hosted gate's frame (backend/app/lib/legal/page_frame_text.py
 *   gate_updated / gate_review / gate_decline / gate_accept) and the legal
 *   notices' document names (account_notice_mail_text.py doc_*);
 * - close: Android / Swift `OneloText` (#1074, #1075).
 * built-in-texts-1079.test.ts pins those copies.
 */
import { fillText, pageLanguage, textsLanguage, type PageLanguageCode } from '@onelo/core'

export type OneloTextKey =
  // Modal chrome
  | 'close'
  // Magic-link / store return cover (handed-over-notice.ts); {app} is the App's name
  | 'signingIn'
  | 'signedIn'
  | 'continueInAppTab'
  | 'continueInTab'
  | 'closeTabReopenApp'
  | 'closeTabReopen'
  // Consent gate (consent.ts); {doc} is the document's name
  | 'docTerms'
  | 'docPrivacy'
  | 'docDpa'
  | 'docCookies'
  | 'docGeneric'
  | 'consentHeading'
  | 'consentBody'
  | 'consentReview'
  | 'signOut'
  | 'acceptAndContinue'
  | 'saving'
  | 'consentSaveFailed'
  // Feature badges (FeatureState.badgeLabel); {plan} is the plan name as written
  | 'badgeNew'
  | 'badgeBeta'
  | 'badgeComingSoon'
  | 'badgeAvailableIn'
  | 'badgeUpgrade'

type Table = Record<OneloTextKey, string>

export const ONELO_TEXTS: Record<PageLanguageCode, Table> = {
  en: {
    close: 'Close',
    signingIn: 'Signing you in…',
    signedIn: "You're signed in",
    continueInAppTab: 'Continue in the {app} tab you started from — you can close this one.',
    continueInTab: 'Continue in the tab you started from — you can close this one.',
    closeTabReopenApp: 'You can close this tab and open {app} again.',
    closeTabReopen: 'You can close this tab and open the app again.',
    docTerms: 'Terms of Service',
    docPrivacy: 'Privacy Policy',
    docDpa: 'Data Processing Agreement',
    docCookies: 'Cookie Policy',
    docGeneric: 'Legal agreement',
    consentHeading: 'We’ve updated our {doc}',
    consentBody: 'Please review and accept to continue',
    consentReview: 'Review full {doc} ↗',
    signOut: 'Sign out',
    acceptAndContinue: 'Accept & Continue',
    saving: 'Saving…',
    consentSaveFailed: 'Could not save — check your connection and try again.',
    badgeNew: 'New',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Coming soon',
    badgeAvailableIn: 'Available in {plan}',
    badgeUpgrade: 'Change plan',
  },
  pl: {
    close: 'Zamknij',
    signingIn: 'Logujemy Cię…',
    signedIn: 'Zalogowano',
    continueInAppTab: 'Kontynuuj w karcie {app}, od której zaczęło się logowanie — tę kartę możesz zamknąć.',
    continueInTab: 'Kontynuuj w karcie, od której zaczęło się logowanie — tę kartę możesz zamknąć.',
    closeTabReopenApp: 'Możesz zamknąć tę kartę i ponownie otworzyć {app}.',
    closeTabReopen: 'Możesz zamknąć tę kartę i ponownie otworzyć aplikację.',
    docTerms: 'Regulamin',
    docPrivacy: 'Polityka prywatności',
    docDpa: 'Umowa powierzenia przetwarzania danych',
    docCookies: 'Polityka cookies',
    docGeneric: 'Dokument prawny',
    consentHeading: 'Zaktualizowaliśmy dokument „{doc}”',
    consentBody: 'Zapoznaj się z dokumentem i zaakceptuj go, aby kontynuować',
    consentReview: 'Przeczytaj cały dokument „{doc}” ↗',
    signOut: 'Wyloguj się',
    acceptAndContinue: 'Akceptuję i kontynuuję',
    saving: 'Zapisywanie…',
    consentSaveFailed: 'Nie udało się zapisać — sprawdź połączenie i spróbuj ponownie.',
    badgeNew: 'Nowość',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Wkrótce',
    badgeAvailableIn: 'Dostępne w planie {plan}',
    badgeUpgrade: 'Zmień plan',
  },
  de: {
    close: 'Schließen',
    signingIn: 'Sie werden angemeldet…',
    signedIn: 'Sie sind angemeldet',
    continueInAppTab: 'Fahren Sie im Tab von {app} fort, in dem Sie begonnen haben – diesen Tab können Sie schließen.',
    continueInTab: 'Fahren Sie im Tab fort, in dem Sie begonnen haben – diesen Tab können Sie schließen.',
    closeTabReopenApp: 'Sie können diesen Tab schließen und {app} erneut öffnen.',
    closeTabReopen: 'Sie können diesen Tab schließen und die App erneut öffnen.',
    docTerms: 'Nutzungsbedingungen',
    docPrivacy: 'Datenschutzerklärung',
    docDpa: 'Auftragsverarbeitungsvertrag',
    docCookies: 'Cookie-Richtlinie',
    docGeneric: 'Rechtliches Dokument',
    consentHeading: 'Wir haben das Dokument „{doc}“ aktualisiert',
    consentBody: 'Bitte lesen und akzeptieren Sie das Dokument, um fortzufahren',
    consentReview: 'Vollständiges Dokument „{doc}“ lesen ↗',
    signOut: 'Abmelden',
    acceptAndContinue: 'Akzeptieren und fortfahren',
    saving: 'Wird gespeichert…',
    consentSaveFailed: 'Speichern fehlgeschlagen – bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    badgeNew: 'Neu',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Demnächst verfügbar',
    badgeAvailableIn: 'Verfügbar im Plan {plan}',
    badgeUpgrade: 'Plan ändern',
  },
  fr: {
    close: 'Fermer',
    signingIn: 'Connexion en cours…',
    signedIn: 'Connexion réussie',
    continueInAppTab: 'Continuez dans l’onglet {app} de départ — vous pouvez fermer celui-ci.',
    continueInTab: 'Continuez dans l’onglet de départ — vous pouvez fermer celui-ci.',
    closeTabReopenApp: 'Vous pouvez fermer cet onglet et rouvrir {app}.',
    closeTabReopen: 'Vous pouvez fermer cet onglet et rouvrir l’application.',
    docTerms: 'Conditions d\'utilisation',
    docPrivacy: 'Politique de confidentialité',
    docDpa: 'Accord de traitement des données',
    docCookies: 'Politique relative aux cookies',
    docGeneric: 'Document juridique',
    consentHeading: 'Nous avons mis à jour le document « {doc} »',
    consentBody: 'Veuillez lire et accepter le document pour continuer',
    consentReview: 'Lire le document « {doc} » en entier ↗',
    signOut: 'Se déconnecter',
    acceptAndContinue: 'Accepter et continuer',
    saving: 'Enregistrement…',
    consentSaveFailed: 'Impossible d’enregistrer — vérifiez votre connexion et réessayez.',
    badgeNew: 'Nouveau',
    badgeBeta: 'Bêta',
    badgeComingSoon: 'Bientôt disponible',
    badgeAvailableIn: 'Disponible avec le plan {plan}',
    badgeUpgrade: 'Changer de plan',
  },
  es: {
    close: 'Cerrar',
    signingIn: 'Iniciando sesión…',
    signedIn: 'Has iniciado sesión',
    continueInAppTab: 'Continúa en la pestaña de {app} en la que empezaste; puedes cerrar esta.',
    continueInTab: 'Continúa en la pestaña en la que empezaste; puedes cerrar esta.',
    closeTabReopenApp: 'Puedes cerrar esta pestaña y volver a abrir {app}.',
    closeTabReopen: 'Puedes cerrar esta pestaña y volver a abrir la aplicación.',
    docTerms: 'Términos del servicio',
    docPrivacy: 'Política de privacidad',
    docDpa: 'Acuerdo de tratamiento de datos',
    docCookies: 'Política de cookies',
    docGeneric: 'Documento legal',
    consentHeading: 'Hemos actualizado el documento «{doc}»',
    consentBody: 'Revisa y acepta el documento para continuar',
    consentReview: 'Leer el documento «{doc}» completo ↗',
    signOut: 'Cerrar sesión',
    acceptAndContinue: 'Aceptar y continuar',
    saving: 'Guardando…',
    consentSaveFailed: 'No se ha podido guardar: comprueba tu conexión e inténtalo de nuevo.',
    badgeNew: 'Nuevo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Próximamente',
    badgeAvailableIn: 'Disponible en el plan {plan}',
    badgeUpgrade: 'Cambiar plan',
  },
  it: {
    close: 'Chiudi',
    signingIn: 'Accesso in corso…',
    signedIn: 'Accesso effettuato',
    continueInAppTab: 'Continua nella scheda di {app} da cui hai iniziato: puoi chiudere questa.',
    continueInTab: 'Continua nella scheda da cui hai iniziato: puoi chiudere questa.',
    closeTabReopenApp: 'Puoi chiudere questa scheda e riaprire {app}.',
    closeTabReopen: 'Puoi chiudere questa scheda e riaprire l’app.',
    docTerms: 'Termini di servizio',
    docPrivacy: 'Informativa sulla privacy',
    docDpa: 'Accordo sul trattamento dei dati',
    docCookies: 'Informativa sui cookie',
    docGeneric: 'Documento legale',
    consentHeading: 'Abbiamo aggiornato il documento «{doc}»',
    consentBody: 'Leggi e accetta il documento per continuare',
    consentReview: 'Leggi il documento «{doc}» completo ↗',
    signOut: 'Esci',
    acceptAndContinue: 'Accetta e continua',
    saving: 'Salvataggio…',
    consentSaveFailed: 'Impossibile salvare: controlla la connessione e riprova.',
    badgeNew: 'Novità',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Prossimamente',
    badgeAvailableIn: 'Disponibile nel piano {plan}',
    badgeUpgrade: 'Cambia piano',
  },
  pt: {
    close: 'Fechar',
    signingIn: 'A iniciar sessão…',
    signedIn: 'Sessão iniciada',
    continueInAppTab: 'Continue no separador de {app} onde começou — pode fechar este.',
    continueInTab: 'Continue no separador onde começou — pode fechar este.',
    closeTabReopenApp: 'Pode fechar este separador e abrir {app} novamente.',
    closeTabReopen: 'Pode fechar este separador e abrir a aplicação novamente.',
    docTerms: 'Termos de Serviço',
    docPrivacy: 'Política de Privacidade',
    docDpa: 'Acordo de Tratamento de Dados',
    docCookies: 'Política de Cookies',
    docGeneric: 'Documento legal',
    consentHeading: 'Atualizámos o documento «{doc}»',
    consentBody: 'Leia e aceite o documento para continuar',
    consentReview: 'Ler o documento «{doc}» completo ↗',
    signOut: 'Terminar sessão',
    acceptAndContinue: 'Aceitar e continuar',
    saving: 'A guardar…',
    consentSaveFailed: 'Não foi possível guardar — verifique a sua ligação e tente novamente.',
    badgeNew: 'Novo',
    badgeBeta: 'Beta',
    badgeComingSoon: 'Brevemente',
    badgeAvailableIn: 'Disponível no plano {plan}',
    badgeUpgrade: 'Mudar de plano',
  },
  nl: {
    close: 'Sluiten',
    signingIn: 'Je wordt ingelogd…',
    signedIn: 'Je bent ingelogd',
    continueInAppTab: 'Ga verder in het tabblad van {app} waarin je begon — dit tabblad kun je sluiten.',
    continueInTab: 'Ga verder in het tabblad waarin je begon — dit tabblad kun je sluiten.',
    closeTabReopenApp: 'Je kunt dit tabblad sluiten en {app} opnieuw openen.',
    closeTabReopen: 'Je kunt dit tabblad sluiten en de app opnieuw openen.',
    docTerms: 'Servicevoorwaarden',
    docPrivacy: 'Privacybeleid',
    docDpa: 'Verwerkersovereenkomst',
    docCookies: 'Cookiebeleid',
    docGeneric: 'Juridisch document',
    consentHeading: 'We hebben het document ‘{doc}’ bijgewerkt',
    consentBody: 'Lees en accepteer het document om verder te gaan',
    consentReview: 'Het volledige document ‘{doc}’ lezen ↗',
    signOut: 'Uitloggen',
    acceptAndContinue: 'Accepteren en doorgaan',
    saving: 'Opslaan…',
    consentSaveFailed: 'Opslaan is mislukt — controleer je verbinding en probeer het opnieuw.',
    badgeNew: 'Nieuw',
    badgeBeta: 'Bèta',
    badgeComingSoon: 'Binnenkort beschikbaar',
    badgeAvailableIn: 'Beschikbaar in het plan {plan}',
    badgeUpgrade: 'Plan wijzigen',
  },
}

/**
 * This text in `language` (default: the current Page Language), with
 * `{name}` placeholders filled in as written. English for a language Onelo
 * does not translate into.
 */
export function oneloText(key: OneloTextKey, fill: Record<string, string> = {}, language: string = pageLanguage()): string {
  return fillText(ONELO_TEXTS[textsLanguage(language)][key], fill)
}

/** localStorage key of the last adopted Page Language: the next page load's
 *  first paint (the magic-link cover goes up before config answers). */
export const PAGE_LANGUAGE_STORAGE_KEY = 'onelo_page_language'

/** The Page Language an earlier page load adopted, or null. Best effort. */
export function keptPageLanguage(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(PAGE_LANGUAGE_STORAGE_KEY) : null
  } catch {
    return null
  }
}

/** Keep the adopted Page Language for the next page load. Best effort. */
export function keepPageLanguage(language: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PAGE_LANGUAGE_STORAGE_KEY, language)
  } catch { /* storage blocked or full — the next load starts in English */ }
}
