const toTemplateId = (name) => String(name || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 64);

export const isTemplateFormValid = (form, editingId = null) => {
  if (!form || typeof form !== 'object') return false;
  if (typeof form.name !== 'string' || form.name.trim().length === 0 || form.name.length > 80) return false;
  if (!editingId && !toTemplateId(form.name)) return false;
  if (typeof form.language !== 'string' || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(form.language)) return false;
  return typeof form.body === 'string' && form.body.trim().length > 0 && form.body.length <= 4096;
};

export { toTemplateId };
