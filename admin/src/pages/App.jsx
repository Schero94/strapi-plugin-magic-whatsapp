import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  EmptyStateLayout,
  Field,
  Flex,
  Loader,
  Main,
  Status,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { Layouts, useFetchClient, useRBAC } from '@strapi/strapi/admin';

import { permissionChecks } from '../permissions';
import { isTemplateFormValid, toTemplateId } from '../utils/template-validation.mjs';

const initialTemplate = { name: '', language: 'de', body: '' };
const statusLabel = {
  disconnected: 'Nicht verbunden',
  connecting: 'Verbindung wird aufgebaut',
  qr_pending: 'Wartet auf QR-Scan',
  connected: 'Verbunden',
  error: 'Verbindung fehlgeschlagen',
};

const readError = (error, fallback) => error?.response?.data?.error?.message || fallback;
const responseData = (response) => response?.data?.data;
const App = () => {
  const { get, post, put, del } = useFetchClient();
  const { allowedActions, isLoading: permissionsLoading, error: permissionsError } = useRBAC(permissionChecks);
  const canAccess = allowedActions.canAccess;
  const canViewStatus = allowedActions.canView;
  const canManageConnection = allowedActions.canManage;
  const canListTemplates = allowedActions.canList;
  const canEditTemplates = allowedActions.canEdit;
  const canSendMessages = allowedActions.canSend;

  const [status, setStatus] = useState(null);
  const [pairingQr, setPairingQr] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [actionError, setActionError] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);
  const [templateForm, setTemplateForm] = useState(initialTemplate);
  const [editingId, setEditingId] = useState(null);
  const [recipient, setRecipient] = useState('');
  const [messageText, setMessageText] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!canViewStatus) return;
    try {
      const response = await get('/magic-whatsapp/status');
      setStatus(responseData(response));
      setStatusError('');
      if (responseData(response)?.state === 'connected') setPairingQr(null);
    } catch (error) {
      setStatusError(readError(error, 'Der Verbindungsstatus konnte nicht geladen werden.'));
    }
  }, [canViewStatus, get]);

  const loadTemplates = useCallback(async () => {
    if (!canListTemplates) return;
    try {
      const response = await get('/magic-whatsapp/templates');
      setTemplates(Array.isArray(responseData(response)) ? responseData(response) : []);
      setTemplateError('');
    } catch (error) {
      setTemplateError(readError(error, 'Die Vorlagen konnten nicht geladen werden.'));
    }
  }, [canListTemplates, get]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStatus(), loadTemplates()]);
    setLoading(false);
  }, [loadStatus, loadTemplates]);

  useEffect(() => {
    if (!permissionsLoading && canAccess) loadPage();
    else if (!permissionsLoading) setLoading(false);
  }, [canAccess, loadPage, permissionsLoading]);

  useEffect(() => {
    if (!canManageConnection || !['connecting', 'qr_pending'].includes(status?.state)) return undefined;
    const timer = setInterval(async () => {
      if (canViewStatus) await loadStatus();
      try {
        const response = await get('/magic-whatsapp/connection/qr');
        setPairingQr(responseData(response) || null);
      } catch {
        // Connection state stays available even when QR permission was revoked.
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [canManageConnection, canViewStatus, get, loadStatus, status?.state]);

  const runConnectionAction = async (action) => {
    setConnectionBusy(true);
    setActionError('');
    try {
      if (action === 'connect') {
        const response = await post('/magic-whatsapp/connection', {});
        const result = responseData(response);
        setStatus(result);
        setPairingQr(result?.qrCode || null);
      } else if (action === 'logout') {
        const response = await del('/magic-whatsapp/connection/session');
        setStatus(responseData(response));
        setPairingQr(null);
      } else {
        const response = await del('/magic-whatsapp/connection');
        setStatus(responseData(response));
        setPairingQr(null);
      }
    } catch (error) {
      setActionError(readError(error, 'Die WhatsApp-Verbindung konnte nicht geändert werden.'));
    } finally {
      setConnectionBusy(false);
    }
  };

  const resetTemplateForm = () => {
    setTemplateForm(initialTemplate);
    setEditingId(null);
    setTemplateError('');
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    if (!isTemplateFormValid(templateForm, editingId)) {
      setTemplateError('Bitte fülle Name, gültigen Sprachcode und Nachrichtentext aus.');
      return;
    }
    setTemplateBusy(true);
    setTemplateError('');
    const fields = { name: templateForm.name, language: templateForm.language, body: templateForm.body };
    const template = { ...fields, id: editingId || toTemplateId(templateForm.name) };
    try {
      if (editingId) await put(`/magic-whatsapp/templates/${encodeURIComponent(editingId)}`, fields);
      else await post('/magic-whatsapp/templates', template);
      await loadTemplates();
      resetTemplateForm();
    } catch (error) {
      setTemplateError(readError(error, 'Die Vorlage konnte nicht gespeichert werden.'));
    } finally {
      setTemplateBusy(false);
    }
  };

  const deleteTemplate = async (id) => {
    if (!window.confirm('Diese Vorlage wirklich löschen?')) return;
    setTemplateBusy(true);
    setTemplateError('');
    try {
      await del(`/magic-whatsapp/templates/${encodeURIComponent(id)}`);
      await loadTemplates();
      if (editingId === id) resetTemplateForm();
    } catch (error) {
      setTemplateError(readError(error, 'Die Vorlage konnte nicht gelöscht werden.'));
    } finally {
      setTemplateBusy(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!confirmSend) {
      setConfirmSend(true);
      return;
    }
    setMessageBusy(true);
    setActionError('');
    try {
      await post('/magic-whatsapp/messages', { recipient, text: messageText });
      setRecipient('');
      setMessageText('');
      setConfirmSend(false);
    } catch (error) {
      setActionError(readError(error, 'Die Nachricht konnte nicht gesendet werden.'));
      setConfirmSend(false);
    } finally {
      setMessageBusy(false);
    }
  };

  if (permissionsLoading || loading) {
    return (
      <Main aria-busy="true" aria-label="WhatsApp wird geladen">
        <Flex direction="column" alignItems="center" gap={3} padding={8}>
          <Loader>WhatsApp wird geladen</Loader>
        </Flex>
      </Main>
    );
  }

  if (permissionsError || !canAccess) {
    return (
      <Main>
        <Box padding={6}>
          <Alert closeLabel="Meldung schließen" title="Kein Zugriff" variant="danger">
            Dir fehlt die Berechtigung, die WhatsApp-Verwaltung zu öffnen.
          </Alert>
        </Box>
      </Main>
    );
  }

  return (
    <Main aria-labelledby="magic-whatsapp-title">
      <Layouts.Header
        id="magic-whatsapp-title"
        title="WhatsApp"
        subtitle="Verbindung, Nachrichten und Vorlagen für diese Strapi-Instanz verwalten."
      />
      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={5} padding={6}>
          {actionError ? (
            <Alert closeLabel="Meldung schließen" title="Aktion fehlgeschlagen" variant="danger" onClose={() => setActionError('')}>
              {actionError}
            </Alert>
          ) : null}

          <Box padding={5} hasRadius background="neutral0" borderColor="neutral150" borderStyle="solid" borderWidth="1px">
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={3}>
                <Box>
                  <Typography variant="delta" as="h2">Verbindung</Typography>
                  <Box marginTop={1}>
                    <Typography variant="pi" textColor="neutral600" as="p">
                      Der Status wird nur über geschützte Admin-Routen geladen.
                    </Typography>
                  </Box>
                </Box>
                {canViewStatus ? (
                  statusError ? (
                    <Status variant="danger">Status nicht verfügbar</Status>
                  ) : (
                    <Status variant={status?.state === 'connected' ? 'success' : status?.state === 'error' ? 'danger' : 'neutral'}>
                      {statusLabel[status?.state] || 'Status wird geladen'}
                    </Status>
                  )
                ) : <Status variant="neutral">Keine Statusberechtigung</Status>}
              </Flex>

              {statusError ? (
                <Alert closeLabel="Meldung schließen" title="Status konnte nicht geladen werden" variant="danger" onClose={() => setStatusError('')}>
                  {statusError}
                </Alert>
              ) : null}

              {status?.lastError?.message ? (
                <Alert closeLabel="Meldung schließen" title="Verbindungsfehler" variant="warning">
                  {status.lastError.message}
                </Alert>
              ) : null}

              {pairingQr ? (
                <Flex direction="column" alignItems="center" gap={3} padding={4} hasRadius background="neutral100">
                  <Typography variant="epsilon" as="h3">Mit WhatsApp verknüpfen</Typography>
                  <Typography variant="pi" textAlign="center" textColor="neutral700">
                    Öffne WhatsApp auf deinem Telefon und scanne den QR-Code. Der Code wird nicht gespeichert.
                  </Typography>
                  <Box padding={2} hasRadius background="neutral0">
                    <img src={pairingQr} alt="Temporärer WhatsApp-Verknüpfungscode" width="280" height="280" />
                  </Box>
                </Flex>
              ) : null}

              {canManageConnection ? (
                <Flex gap={3} wrap="wrap">
                  {status?.isConnected || status?.state === 'qr_pending' || status?.state === 'connecting' ? (
                    <Button variant="secondary" disabled={connectionBusy} loading={connectionBusy} onClick={() => runConnectionAction('disconnect')}>
                      Verbindung trennen
                    </Button>
                  ) : (
                    <Button disabled={connectionBusy} loading={connectionBusy} onClick={() => runConnectionAction('connect')}>
                      WhatsApp verbinden
                    </Button>
                  )}
                  {status?.isConnected ? (
                    <Button variant="danger-light" disabled={connectionBusy} onClick={() => {
                      if (window.confirm('WhatsApp abmelden und die gespeicherte Sitzung entfernen?')) runConnectionAction('logout');
                    }}>
                      Sitzung entfernen
                    </Button>
                  ) : null}
                </Flex>
              ) : null}
            </Flex>
          </Box>

          {canSendMessages ? (
            <Box padding={5} hasRadius background="neutral0" borderColor="neutral150" borderStyle="solid" borderWidth="1px">
              <Box marginBottom={4}><Typography variant="delta" as="h2">Nachricht senden</Typography></Box>
              <form onSubmit={sendMessage}>
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <Field.Root name="recipient" id="magic-whatsapp-recipient" required>
                    <Field.Label>Telefonnummer</Field.Label>
                    <Field.Input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      pattern="[+][1-9][0-9]{7,14}"
                      placeholder="+Ländervorwahl und Nummer"
                      value={recipient}
                      onChange={(event) => { setRecipient(event.target.value); setConfirmSend(false); }}
                      required
                    />
                    <Field.Hint>Mit internationaler Vorwahl, zum Beispiel im Format +49…</Field.Hint>
                  </Field.Root>
                  <Field.Root name="message" id="magic-whatsapp-message" required>
                    <Field.Label>Nachricht</Field.Label>
                    <Textarea
                      value={messageText}
                      onChange={(event) => { setMessageText(event.target.value); setConfirmSend(false); }}
                      maxLength={4096}
                      rows={4}
                      required
                      aria-describedby="magic-whatsapp-message-count"
                    />
                    <Typography id="magic-whatsapp-message-count" variant="pi" textColor="neutral600">
                      {messageText.length} von 4.096 Zeichen
                    </Typography>
                  </Field.Root>
                  {confirmSend ? (
                    <Alert closeLabel="Meldung schließen" title="Nachricht bestätigen" variant="warning">
                      Die Nachricht wird jetzt an {recipient} gesendet. Prüfe Nummer und Text, bevor du fortfährst.
                    </Alert>
                  ) : null}
                  <Flex gap={3} wrap="wrap">
                    <Button
                      type="submit"
                      disabled={messageBusy || !status?.isConnected || !recipient || !messageText}
                      loading={messageBusy}
                      variant={confirmSend ? 'danger' : 'default'}
                    >
                      {confirmSend ? 'Jetzt endgültig senden' : 'Nachricht senden…'}
                    </Button>
                    {confirmSend ? (
                      <Button variant="tertiary" onClick={() => setConfirmSend(false)}>Abbrechen</Button>
                    ) : null}
                  </Flex>
                </Flex>
              </form>
            </Box>
          ) : null}

          {(canListTemplates || canEditTemplates) ? (
            <Box padding={5} hasRadius background="neutral0" borderColor="neutral150" borderStyle="solid" borderWidth="1px">
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={3}>
                  <Box>
                    <Typography variant="delta" as="h2">Vorlagen</Typography>
                    <Box marginTop={1}>
                      <Typography variant="pi" textColor="neutral600" as="p">
                        Vorlagen werden in der Magic-WhatsApp-Pluginablage gespeichert.
                      </Typography>
                    </Box>
                  </Box>
                  {canEditTemplates && !editingId ? <Button variant="secondary" onClick={() => setTemplateForm(initialTemplate)}>Neue Vorlage</Button> : null}
                </Flex>

                {templateError ? (
                  <Alert closeLabel="Meldung schließen" title="Vorlagenfehler" variant="danger" onClose={() => setTemplateError('')}>
                    {templateError}
                  </Alert>
                ) : null}

                {canEditTemplates ? (
                  <form onSubmit={saveTemplate}>
                    <Flex direction="column" alignItems="stretch" gap={3}>
                      <Typography variant="epsilon" as="h3">{editingId ? 'Vorlage bearbeiten' : 'Vorlage erstellen'}</Typography>
                      <Field.Root name="template-name" id="magic-whatsapp-template-name" required>
                        <Field.Label>Name</Field.Label>
                        <Field.Input
                          value={templateForm.name}
                          onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}
                          maxLength={80}
                          required
                        />
                      </Field.Root>
                      <Field.Root name="template-language" id="magic-whatsapp-template-language" required>
                        <Field.Label>Sprache</Field.Label>
                        <Field.Input
                          value={templateForm.language}
                          onChange={(event) => setTemplateForm({ ...templateForm, language: event.target.value })}
                          pattern="[a-z]{2}(_[A-Z]{2})?"
                          maxLength={5}
                          required
                        />
                        <Field.Hint>Sprachcode, zum Beispiel de oder de_DE.</Field.Hint>
                      </Field.Root>
                      <Field.Root name="template-body" id="magic-whatsapp-template-body" required>
                        <Field.Label>Nachrichtentext</Field.Label>
                        <Textarea
                          value={templateForm.body}
                          onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })}
                          maxLength={4096}
                          rows={4}
                          required
                        />
                        <Field.Hint>Platzhalter kannst du als {'{{name}}'} einfügen.</Field.Hint>
                      </Field.Root>
                      <Flex gap={3} wrap="wrap">
                        <Button type="submit" disabled={templateBusy || !isTemplateFormValid(templateForm, editingId)} loading={templateBusy}>
                          {editingId ? 'Änderungen speichern' : 'Vorlage speichern'}
                        </Button>
                        {editingId ? <Button type="button" variant="tertiary" onClick={resetTemplateForm}>Abbrechen</Button> : null}
                      </Flex>
                    </Flex>
                  </form>
                ) : null}

                {canListTemplates ? (
                  templates.length > 0 ? (
                    <Flex direction="column" alignItems="stretch" gap={3}>
                      {templates.map((template) => (
                        <Box key={template.id} padding={4} hasRadius background="neutral100">
                          <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
                            <Box flex="1 1 280px">
                              <Typography variant="epsilon" as="h3">{template.name}</Typography>
                              <Typography variant="pi" textColor="neutral600">{template.language} · {template.id}</Typography>
                              <Box marginTop={2}><Typography variant="pi" as="p">{template.body}</Typography></Box>
                            </Box>
                            {canEditTemplates ? (
                              <Flex gap={2} wrap="wrap">
                                <Button variant="tertiary" onClick={() => {
                                  setEditingId(template.id);
                                  setTemplateForm({ name: template.name, language: template.language, body: template.body });
                                  setTemplateError('');
                                }}>Bearbeiten</Button>
                                <Button variant="danger-light" disabled={templateBusy} onClick={() => deleteTemplate(template.id)}>Löschen</Button>
                              </Flex>
                            ) : null}
                          </Flex>
                        </Box>
                      ))}
                    </Flex>
                  ) : (
                    <EmptyStateLayout content="Es gibt noch keine Vorlagen. Lege eine Vorlage an, um wiederkehrende Nachrichten vorzubereiten." />
                  )
                ) : null}
              </Flex>
            </Box>
          ) : null}
        </Flex>
      </Layouts.Content>
    </Main>
  );
};

export default App;
