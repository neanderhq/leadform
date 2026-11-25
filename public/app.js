import { validEmail } from './validation.js';
const app = document.querySelector('#app');
const questionTypes = [['short','Short text'],['email','Email'],['number','Number'],['multiple','Multiple choice'],['yesno','Yes / No'],['rating','Rating (1–5)']];
const defaults = { primary:'#5366d8', background:'#f7f7f5', text:'#202124', logo:'' };
let currentForm = null;
let editorDirty = false;
let currentRoute = location.pathname;
const esc = (value='') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const api = async (url, options={}) => {
  // Fetch the current session token for owner writes, including after login rotates the session.
  const ownerWrite = options.method && !['GET', 'HEAD'].includes(options.method) && !url.startsWith('/api/public/');
  const csrf = ownerWrite ? await (await fetch('/api/session')).json() : null;
  const response = await fetch(url, { ...options, headers:{ ...(csrf ? {'X-CSRF-Token':csrf.csrfToken} : {}), ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers||{}) } });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status:response.status, body });
  return body;
};
const json = value => JSON.stringify(value);
const leaveEditorMessage = 'You have unsaved changes. Leave this page and discard them?';
const go = url => {
  if (editorDirty && !confirm(leaveEditorMessage)) return;
  editorDirty = false;
  history.pushState({}, '', url);
  currentRoute = url;
  route();
};
window.addEventListener('popstate', () => {
  if (editorDirty && !confirm(leaveEditorMessage)) {
    history.pushState({}, '', currentRoute);
    return;
  }
  editorDirty = false;
  currentRoute = location.pathname;
  route();
});
window.addEventListener('beforeunload', event => {
  if (!editorDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
function formatDate(value) { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(value)); }
function formatDateTime(value) { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(value)); }
function header(actions='') { return `<header class="topbar"><a class="wordmark" href="/" data-nav="/">Leadform</a><div class="top-actions">${actions}</div></header>`; }
function showToast(message) { const node=document.createElement('div');node.className='toast';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),2100); }

async function route() {
  const pathname=location.pathname;
  if (pathname.startsWith('/embed/')) return publicView(decodeURIComponent(pathname.slice(7)), false, true);
  if (pathname.startsWith('/f/')) return publicView(decodeURIComponent(pathname.slice(3)), false);
  if (pathname.startsWith('/preview/')) return publicView(decodeURIComponent(pathname.slice(9)), true);
  if (pathname.startsWith('/responses/')) return responsesView(decodeURIComponent(pathname.slice(11)));
  if (pathname.startsWith('/edit/')) return editorView(decodeURIComponent(pathname.slice(6)));
  const state=await api('/api/session');
  if (!state.owner) return loginView();
  return dashboardView();
}
async function loginView() {
  app.innerHTML=DOMPurify.sanitize(`<main class="login-wrap"><form class="login-card" id="login-form"><div class="wordmark">Leadform</div><h1>Welcome back</h1><p>Sign in to manage your forms and responses.</p><div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required value="admin"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div id="login-error" class="error" role="alert"></div><button class="button primary" type="submit">Sign in</button></form></main>`);
  document.querySelector('#login-form').addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));try{await api('/api/login',{method:'POST',body:json(data)});go('/')}catch(error){document.querySelector('#login-error').textContent=error.message;}});
}
async function dashboardView() {
  try {
    const forms=await api('/api/forms');
    app.innerHTML=DOMPurify.sanitize(`<main class="shell">${header('<button class="button ghost" id="logout">Sign out</button>')}<section class="dashboard-head"><div><p class="eyebrow">Workspace</p><h1 class="page-title">Your forms</h1><p class="intro muted">Create a form and gather the responses that matter.</p></div><button class="button primary" id="create">＋ Create form</button></section>${forms.length?`<section class="form-list">${forms.map(form=>`<article class="form-card"><div><h2 class="form-title">${esc(form.title)}</h2><div class="form-meta">${form.response_count} ${form.response_count===1?'response':'responses'} · ${publicationLabel(form)} · Created ${formatDate(form.created_at)}</div></div><div class="row-actions"><button class="button small" data-response="${form.id}">View responses</button><button class="button small" data-edit="${form.id}">Edit</button><button class="button small danger" data-delete="${form.id}">Delete</button></div></article>`).join('')}</section>`:`<section class="empty"><h2>No forms yet</h2><p>Create your first form to start collecting responses.</p><button class="button primary" id="create-empty">Create your first form</button></section>`}</main>`);
    document.querySelector('#logout').onclick=async()=>{await api('/api/logout',{method:'POST'});go('/')};
    const create=async()=>{try{const form=await api('/api/forms',{method:'POST',body:'{}'});go(`/edit/${form.id}`)}catch(error){showToast(error.message)}};
    document.querySelector('#create').onclick=create;document.querySelector('#create-empty')?.addEventListener('click',create);
    document.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>go(`/edit/${button.dataset.edit}`));
    document.querySelectorAll('[data-response]').forEach(button=>button.onclick=()=>go(`/responses/${button.dataset.response}`));
    document.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{const form=forms.find(item=>item.id===button.dataset.delete);if(!confirm(`Delete “${form.title}” and all its responses?`))return;try{await api(`/api/forms/${form.id}`,{method:'DELETE'});dashboardView()}catch(error){showToast(error.message)}});
  } catch(error) { if(error.status===401)return loginView(false); app.innerHTML=DOMPurify.sanitize(`<main class="shell"><p class="error">${esc(error.message)}</p></main>`); }
}
function questionTemplate(question,index,questions) {
  const types=questionTypes.map(([value,label])=>`<option value="${value}" ${question.type===value?'selected':''}>${label}</option>`).join('');
  const destinations=[['','Next question (in order)'],...questions.flatMap((q,questionIndex)=>questionIndex>index?[[q.id,`${questionIndex+1}. ${q.title||'Untitled question'}`]]:[]),['end','End form']];
  const select=(value,useDefault=false)=>`${useDefault?'<option value="default">Use default step</option>':''}${destinations.map(([id,label])=>`<option value="${esc(id)}" ${String(value??'')===id?'selected':''}>${esc(label)}</option>`).join('')}`;
  let branching='';
  if(question.type==='multiple'||question.type==='yesno') {
    const choices=question.type==='multiple'?(question.options||[]):['Yes','No'];
    branching=`<div class="branch-box"><p class="label">Branching</p>${choices.map(choice=>`<div class="branch-row"><label>${esc(choice)}</label><select data-rule="${esc(choice)}" aria-label="If ${esc(choice)}, go to">${select(question.rules?.[choice]??'default',true)}</select></div>`).join('')}<div class="branch-row"><label>Default / all other answers</label><select data-default-next aria-label="Default next step">${select(question.defaultNext)}</select></div></div>`;
  }
  return `<article class="question-card" data-question="${esc(question.id)}"><div class="question-top"><span class="question-index">${String(index+1).padStart(2,'0')}</span><input class="control" data-qtitle value="${esc(question.title)}" aria-label="Question ${index+1} text" placeholder="Write your question"><div class="question-tools"><button type="button" data-up aria-label="Move question up" ${index===0?'disabled':''}>↑</button><button type="button" data-down aria-label="Move question down" ${index===questions.length-1?'disabled':''}>↓</button><button type="button" data-remove aria-label="Delete question">×</button></div></div><div class="question-error" data-question-error role="alert"></div><div class="two-col"><label class="field"><span class="label">Question type</span><select class="control" data-type>${types}</select></label><label class="toggle"><input type="checkbox" data-required ${question.required?'checked':''}> Required</label></div>${question.type==='multiple'?`<div class="option-list">${(question.options||[]).map((option,i)=>`<div class="option-row"><input class="control" data-option="${i}" value="${esc(option)}" aria-label="Choice ${i+1}"><button type="button" class="button small" data-remove-option="${i}" aria-label="Remove choice">×</button></div>`).join('')}</div><button type="button" class="button small" data-add-option>＋ Add option</button>`:''}${branching}</article>`;
}
async function editorView(id) {
  try {
    currentForm=await api(`/api/forms/${id}`);
    renderEditor();
  } catch(error) { if(error.status===401)return loginView(false);app.innerHTML=DOMPurify.sanitize(`<main class="shell"><button class="button" data-nav="/">← Dashboard</button><p class="error">${esc(error.message)}</p></main>`); }
}
function editorSnapshot() {
  const title=document.querySelector('#form-title')?.value??currentForm.title;
  const description=document.querySelector('#form-description')?.value??currentForm.description;
  const questions=[...document.querySelectorAll('.question-card')].map(card=>{
    const original=currentForm.questions.find(q=>q.id===card.dataset.question) || {};
    const type=card.querySelector('[data-type]').value;
    const question={id:original.id,title:card.querySelector('[data-qtitle]').value,type,required:card.querySelector('[data-required]').checked,options:type==='multiple'?[...card.querySelectorAll('[data-option]')].map(input=>input.value):[],rules:{},defaultNext:card.querySelector('[data-default-next]')?.value||''};
    card.querySelectorAll('[data-rule]').forEach(select=>question.rules[select.dataset.rule]=select.value);
    return question;
  });
  const design={primary:document.querySelector('#primary-color')?.value||currentForm.design?.primary||defaults.primary,background:document.querySelector('#background-color')?.value||currentForm.design?.background||defaults.background,text:document.querySelector('#text-color')?.value||currentForm.design?.text||defaults.text,logo:document.querySelector('#logo-url')?.value??currentForm.design?.logo??''};
  return {...currentForm,title,description,questions,design};
}
function publicationLabel(form) {
  if (form.published_version === null) return 'Draft only';
  return form.published_version === form.draft_version ? 'Published' : 'Published · Draft changes';
}
function renderEditor() {
  const form=currentForm;form.design={...defaults,...form.design};form.questions ||= [];
  editorDirty=false;
  app.innerHTML=DOMPurify.sanitize(`<main class="shell editor-shell"><header class="editor-head"><div><button class="button ghost" data-nav="/">← Dashboard</button><h1 class="editor-title">Edit form</h1></div><div class="top-actions"><button class="button" id="preview">Preview</button><button class="button" id="copy-link">Copy link</button><button class="button" id="embed-form">Embed on website</button><button class="button" id="save">Save draft</button><button class="button primary" id="publish">Publish</button></div></header><div class="editor-publication"><strong id="publication-state">${publicationLabel(form)}</strong><span id="save-state" class="save-state" role="status"></span></div><p class="editor-sharing-note">Save draft to keep your edits private. Publish updates the form at its public link.</p><div class="editor-layout"><section><div class="panel"><div class="field"><label for="form-title">Form title</label><input id="form-title" class="control" value="${esc(form.title)}" maxlength="200"></div><div class="field"><label for="form-description">Description</label><textarea id="form-description" class="control">${esc(form.description)}</textarea></div></div><div class="panel" style="margin-top:16px"><p class="section-label">Questions</p><div id="questions">${form.questions.map((q,i)=>questionTemplate(q,i,form.questions)).join('')}</div><button class="button" id="add-question">＋ Add question</button></div></section><aside class="panel side-panel"><p class="section-label">Design</p><div class="color-row"><label for="primary-color">Primary color</label><input type="color" id="primary-color" value="${esc(form.design.primary)}"></div><div class="color-row"><label for="background-color">Background</label><input type="color" id="background-color" value="${esc(form.design.background)}"></div><div class="color-row"><label for="text-color">Text color</label><input type="color" id="text-color" value="${esc(form.design.text)}"></div><div class="field" style="margin-top:18px"><label for="logo-url">Logo image URL</label><input id="logo-url" class="control" type="url" placeholder="https://…" value="${esc(form.design.logo)}"><div class="logo-preview-wrap"><img id="logo-preview" alt="Logo preview"><span id="logo-preview-empty">Logo preview appears here</span></div></div><p class="hint">Preview includes unsaved edits. Respondents see the published version.</p></aside></div></main>`);
  const getSnapshot=()=>editorSnapshot();
  const saveState = document.querySelector('#save-state');
  const saveButton = document.querySelector('#save');
  const publishButton = document.querySelector('#publish');
  const copyButton = document.querySelector('#copy-link');
  const embedButton = document.querySelector('#embed-form');
  const publicationState = document.querySelector('#publication-state');
  let savedForm = form;
  let editVersion = 0;
  let saving = false;
  let publishing = false;
  const updatePublication = () => {
    const hasPublicForm = savedForm.published_version !== null;
    copyButton.disabled = !hasPublicForm;
    embedButton.disabled = !hasPublicForm;
    const canPublish = !editorDirty && !saving && !publishing && savedForm.questions.length > 0
      && savedForm.draft_version !== savedForm.published_version;
    publishButton.setAttribute('aria-disabled', String(!canPublish));
    publishButton.textContent = publishing ? 'Publishing…' : hasPublicForm ? 'Publish changes' : 'Publish';
    publicationState.textContent = publicationLabel(savedForm);
  };
  const setSaveState = (message, state = '') => {
    saveState.textContent = message;
    saveState.className = ['save-state', state].filter(Boolean).join(' ');
  };
  const markUnsaved = () => {
    editVersion++;
    editorDirty = true;
    setSaveState(saving ? 'Saving earlier edits…' : 'Unsaved changes');
    updatePublication();
    document.querySelectorAll('[data-question-error]').forEach(error => error.textContent = '');
  };
  const updateLogoPreview=()=>{
    const image=document.querySelector('#logo-preview');
    const empty=document.querySelector('#logo-preview-empty');
    image.hidden=true;
    empty.hidden=false;
    image.onload=()=>{image.hidden=false;empty.hidden=true;};
    image.onerror=()=>{image.hidden=true;empty.hidden=false;};
    let url;
    try {
      const candidate = new URL(document.querySelector('#logo-url').value);
      if (candidate.protocol === 'https:' || candidate.protocol === 'http:') url = candidate.href;
    } catch { /* An unfinished or invalid URL has no preview. */ }
    if(url)image.src=url;else image.removeAttribute('src');
  };
  const renderQuestions = (id, focusSelectors = []) => {
    const container = document.querySelector('#questions');
    container.innerHTML = DOMPurify.sanitize(currentForm.questions.map((q, i) => questionTemplate(q, i, currentForm.questions)).join(''));
    attachQuestionEvents();
    const question = id && container.querySelector(`[data-question="${CSS.escape(id)}"]`);
    if (!question) return;
    for (const selector of focusSelectors) {
      const control = question.querySelector(selector);
      if (control && !control.disabled) {
        control.focus();
        break;
      }
    }
  };
  const attachQuestionEvents=()=>{
    document.querySelectorAll('.question-card').forEach(card=>{
      card.querySelector('[data-type]').onchange=()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.type=card.querySelector('[data-type]').value;if(q.type==='multiple'&&!q.options?.length)q.options=['Option 1','Option 2'];markUnsaved();renderQuestions(q.id, ['[data-type]'])};
      card.querySelector('[data-qtitle]').oninput=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.title=event.target.value;markUnsaved()};
      card.querySelector('[data-required]').onchange=event=>{currentForm.questions.find(item=>item.id===card.dataset.question).required=event.target.checked;markUnsaved()};
      card.querySelectorAll('[data-option]').forEach(input=>input.oninput=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);const index=Number(event.target.dataset.option);const previous=q.options[index];const next=event.target.value;if(previous!==next){if(Object.hasOwn(q.rules||{},previous)){q.rules[next]=q.rules[previous];delete q.rules[previous]}const branch=[...card.querySelectorAll('[data-rule]')].find(select=>select.dataset.rule===previous);if(branch){branch.dataset.rule=next;branch.setAttribute('aria-label',`If ${next}, go to`);branch.previousElementSibling.textContent=next}}q.options[index]=next;markUnsaved()});
      card.querySelectorAll('[data-rule]').forEach(select=>select.onchange=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.rules={...q.rules,[event.target.dataset.rule]:event.target.value};markUnsaved()});
      card.querySelector('[data-default-next]')?.addEventListener('change',event=>{currentForm.questions.find(item=>item.id===card.dataset.question).defaultNext=event.target.value;markUnsaved()});
      card.querySelector('[data-add-option]')?.addEventListener('click',()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.options.push(`Option ${q.options.length+1}`);markUnsaved();renderQuestions(q.id, [`[data-option="${q.options.length-1}"]`])});
      card.querySelectorAll('[data-remove-option]').forEach(button=>button.onclick=()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);const index=Number(button.dataset.removeOption);delete q.rules?.[q.options[index]];q.options.splice(index,1);markUnsaved();renderQuestions(q.id, [`[data-option="${Math.min(index,q.options.length-1)}"]`, '[data-add-option]'])});
      card.querySelector('[data-remove]').onclick=()=>{const removedId=card.dataset.question;currentForm.questions=currentForm.questions.filter(item=>item.id!==removedId);for(const item of currentForm.questions){for(const [choice,target] of Object.entries(item.rules||{}))if(target===removedId)delete item.rules[choice];if(item.defaultNext===removedId)item.defaultNext=''}markUnsaved();renderQuestions()};
      card.querySelector('[data-up]').onclick=()=>moveQuestion(card.dataset.question,-1);
      card.querySelector('[data-down]').onclick=()=>moveQuestion(card.dataset.question,1);
    });
  };
  const moveQuestion=(questionId,step)=>{
    const index=currentForm.questions.findIndex(q=>q.id===questionId);const destination=index+step;if(destination<0||destination>=currentForm.questions.length)return;
    [currentForm.questions[index],currentForm.questions[destination]]=[currentForm.questions[destination],currentForm.questions[index]];
    const questionIndexes=new Map(currentForm.questions.map((question,questionIndex)=>[question.id,questionIndex]));let removedRules=0;
    currentForm.questions.forEach((question,questionIndex)=>{
      for(const [choice,target] of Object.entries(question.rules||{}))if(questionIndexes.has(target)&&questionIndexes.get(target)<=questionIndex){delete question.rules[choice];removedRules++;}
      if(question.defaultNext&&questionIndexes.has(question.defaultNext)&&questionIndexes.get(question.defaultNext)<=questionIndex){question.defaultNext='';removedRules++;}
    });
    markUnsaved();
    const moveControls = step < 0 ? ['[data-up]', '[data-down]'] : ['[data-down]', '[data-up]'];
    renderQuestions(questionId, [...moveControls, '[data-qtitle]']);
    if(removedRules)showToast('Removed backward branch rules. They now use the default next step.');
  };
  attachQuestionEvents();
  document.querySelector('#add-question').onclick = () => {
    const question = {id: crypto.randomUUID(), title: '', type: 'short', required: false, options: [], rules: {}, defaultNext: ''};
    currentForm.questions.push(question);
    markUnsaved();
    renderQuestions(question.id, ['[data-qtitle]']);
  };
  saveButton.onclick = async () => {
    if (saving || publishing) return;
    const version = editVersion;
    const body = json(getSnapshot());
    saving = true;
    // Keep focus on Save while the request is pending. The guard also covers keyboard activation.
    saveButton.setAttribute('aria-disabled', 'true');
    setSaveState('Saving…');
    updatePublication();
    document.querySelectorAll('[data-question-error]').forEach(error => error.textContent = '');
    try {
      const saved = await api(`/api/forms/${form.id}`, {method: 'PUT', body});
      if (!saveState.isConnected) return;
      savedForm = saved;
      if (editVersion === version) {
        currentForm = saved;
        editorDirty = false;
        setSaveState('Saved', 'ok');
        showToast('Saved');
      } else {
        setSaveState('Unsaved changes');
        showToast('Earlier edits saved');
      }
    } catch (error) {
      if (!saveState.isConnected) return;
      setSaveState(error.message, 'error');
      const questionIndex = error.body?.questionIndex;
      if (editVersion === version && Number.isInteger(questionIndex)) {
        const card = document.querySelectorAll('.question-card')[questionIndex];
        const questionError = card?.querySelector('[data-question-error]');
        if (questionError) questionError.textContent = error.message;
        card?.querySelector('[data-qtitle]')?.focus();
      }
    } finally {
      saving = false;
      saveButton.removeAttribute('aria-disabled');
      updatePublication();
    }
  };
  publishButton.onclick = async () => {
    if (publishButton.getAttribute('aria-disabled') === 'true') return;
    publishing = true;
    saveButton.setAttribute('aria-disabled', 'true');
    setSaveState('Publishing…');
    updatePublication();
    try {
      const published = await api(`/api/forms/${form.id}/publish`, {
        method: 'POST', body: json({version: savedForm.draft_version})
      });
      if (!saveState.isConnected) return;
      savedForm = published;
      setSaveState(editorDirty ? 'Unsaved changes' : 'Published', editorDirty ? '' : 'ok');
    } catch (error) {
      if (saveState.isConnected) setSaveState(error.message, 'error');
    } finally {
      publishing = false;
      saveButton.removeAttribute('aria-disabled');
      updatePublication();
    }
  };
  updatePublication();
  document.querySelectorAll('#form-title,#form-description,#primary-color,#background-color,#text-color').forEach(input=>input.addEventListener('input',markUnsaved));
  document.querySelector('#logo-url').addEventListener('input',()=>{markUnsaved();updateLogoPreview()});
  updateLogoPreview();
  document.querySelector('#preview').onclick=()=>{const draft=getSnapshot();sessionStorage.setItem('leadform-preview',json(draft));window.open(`/preview/${draft.id}`,'_blank')};
  embedButton.onclick = () => showEmbedSnippet(form.id, embedButton);
  copyButton.onclick = async () => {
    const link = `${location.origin}/f/${form.id}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Public link copied');
    } catch {
      window.prompt('Copy the public link', link);
    }
  };
}


function showEmbedSnippet(id, trigger) {
  const url = `${location.origin}/embed/${encodeURIComponent(id)}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'embed-heading');
  dialog.innerHTML = DOMPurify.sanitize(`
    <h2 id="embed-heading">Embed on your website</h2>
    <p class="muted">Paste this code into an HTML block on your website. The embed uses the published form.</p>
    <div class="field">
      <label for="embed-code">Embed code</label>
      <textarea id="embed-code" rows="4" readonly></textarea>
    </div>
    <div class="response-actions">
      <button class="button primary" id="copy-embed-code" type="button">Copy embed code</button>
      <button class="button" id="close-embed" type="button">Done</button>
    </div>
    <p id="embed-copy-status" role="status" class="muted" hidden></p>
  `);
  const code = dialog.querySelector('#embed-code');
  code.value = `<iframe src="${esc(url)}" title="Leadform response form" style="display:block;width:100%;height:650px;border:0"></iframe>`;
  const notice = dialog.querySelector('#embed-copy-status');
  dialog.querySelector('#copy-embed-code').onclick = async () => {
    try {
      await navigator.clipboard.writeText(code.value);
      notice.textContent = 'Embed code copied.';
    } catch {
      code.focus();
      code.select();
      notice.textContent = 'Copy the selected embed code.';
    }
    notice.hidden = false;
  };
  dialog.querySelector('#close-embed').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    dialog.remove();
    trigger.focus();
  }, {once:true});
  app.append(dialog);
  dialog.showModal();
  dialog.querySelector('#copy-embed-code').focus();
}

function calculatePath(form,answers) {
  const questions=form.questions;const result=[];let index=0;
  for(let count=0;index!==null&&index>=0&&index<questions.length&&count<=questions.length;count++){
    const question=questions[index];if(result.includes(question.id))break;result.push(question.id);
    if(!(question.id in answers))break;
    let destination;
    if(question.type==='multiple'||question.type==='yesno'){const rule=question.rules?.[String(answers[question.id])];destination=rule==='default'?question.defaultNext:rule??question.defaultNext;}
    if(destination==='end')index=null;
    else if(destination)index=questions.findIndex(item=>item.id===destination);
    else index=index+1<questions.length?index+1:null;
  }
  return result;
}
const validateAnswer=(question,value)=>{
  const empty=value===undefined||value===null||String(value).trim()==='';
  if(question.required&&empty)return 'This question is required';if(empty)return '';
  if(question.type==='email'&&!validEmail(String(value)))return 'Please enter a valid email address';
  if(question.type==='number'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value).trim()))return 'Please enter a valid number';
  return '';
};
async function publicView(id,preview,embedded=false) {
  let form;
  if(preview){try{form=JSON.parse(sessionStorage.getItem('leadform-preview')||'null');if(!form||form.id!==id)throw new Error('Preview is no longer available')}catch(error){app.innerHTML=DOMPurify.sanitize(`<main class="shell"><p>${esc(error.message)}</p></main>`);return}}
  else {try{form=await api(`/api/public/forms/${encodeURIComponent(id)}`)}catch(error){app.innerHTML=DOMPurify.sanitize(`<main class="shell"><section class="empty"><h2>Form not found</h2><p>This form may be unpublished, deleted or linked incorrectly.</p></section></main>`);return}}
  mountRespondent(form,preview,embedded);
}
function mountRespondent(form,preview,embedded) {
  const questions = form.questions || [];
  const answers = Object.create(null);
  let activeId = questions[0]?.id || null;
  let done = false;
  let errorMessage = '';
  let submitting = false;
  const design={...defaults,...(form.design||{})};
  const color = (value, fallback) => /^#[\da-f]{6}$/i.test(String(value)) ? value : fallback;
  const css=`--primary:${color(design.primary, defaults.primary)};--bg:${color(design.background, defaults.background)};--text:${color(design.text, defaults.text)}`;
  const longestFrom=(index,visited=new Set())=>{
    if(index<0||index>=questions.length||visited.has(index))return 0;
    const nextVisited=new Set(visited);nextVisited.add(index);
    const question=questions[index];let destinations;
    if(question.type==='multiple'||question.type==='yesno'){
      const choices=question.type==='multiple'?question.options||[]:['Yes','No'];
      const targets=[question.defaultNext,...choices.map(choice=>{const rule=question.rules?.[choice];return rule==='default'?question.defaultNext:rule??question.defaultNext;})];
      destinations=targets.map(target=>target==='end'?null:target?questions.findIndex(item=>item.id===target):index+1).filter((target,destinationIndex,all)=>all.indexOf(target)===destinationIndex);
    }else destinations=[index+1];
    return 1+Math.max(0,...destinations.map(target=>target===null?0:longestFrom(target,nextVisited)));
  };
  const longestPath=questions.length?longestFrom(0):0;
  const nextFor=(question,value,index)=>{
    let target;if(question.type==='multiple'||question.type==='yesno'){const rule=question.rules?.[String(value)];target=rule==='default'?question.defaultNext:rule??question.defaultNext;}
    if(target==='end')return null;if(target)return questions.find(q=>q.id===target)?.id??null;return questions[index+1]?.id??null;
  };
  const choicesFor = question => {
    if (question.type === 'multiple') return question.options || [];
    if (question.type === 'yesno') return ['Yes', 'No'];
    if (question.type === 'rating') return ['1', '2', '3', '4', '5'];
    return null;
  };
  const variableLength = questions.some(question =>
    [question.defaultNext, ...Object.values(question.rules || {})].some(target => target && target !== 'default')
  );
  const selectChoice = (question, value) => {
    if (submitting) return;
    answers[question.id] = value;
    errorMessage = '';
    discardSkippedAnswers();
    render(value);
  };
  const discardSkippedAnswers = () => {
    const reachable = new Set(calculatePath(form, answers));
    for (const key of Object.keys(answers)) if (!reachable.has(key)) delete answers[key];
  };
  const answerControl = (question, options) => {
    const error = errorMessage ? 'aria-invalid="true" aria-describedby="answer-error"' : '';
    if (options) {
      const layout = question.type === 'rating' ? 'rating-list' : 'choice-list';
      const buttons = options.map((choice, index) => {
        const selected = answers[question.id] === choice;
        const shortcut = question.type !== 'rating' && index < 9
          ? `<span class="choice-key" aria-hidden="true">${index + 1}</span>` : '';
        return `<button type="button" class="choice${selected ? ' selected' : ''}" aria-pressed="${selected}" data-choice="${esc(choice)}" ${error} ${submitting ? 'disabled' : ''}>${shortcut}<span>${esc(choice)}</span></button>`;
      }).join('');
      return `<div class="${layout}" role="group" aria-labelledby="question-title">${buttons}</div>`;
    }
    const type = question.type === 'email' ? 'email' : 'text';
    return `<input class="answer-input" id="answer" type="${type}"
      ${question.type === 'number' ? 'inputmode="decimal"' : ''}
      value="${esc(answers[question.id] || '')}" aria-label="${esc(question.title || 'Your answer')}"
      ${question.required ? 'required' : ''} ${error} ${submitting ? 'readonly' : ''}
      autocomplete="${type === 'email' ? 'email' : 'off'}" placeholder="Type your answer here…">`;
  };
  const render = (preferredChoice, focusQuestion = true) => {
    const path = calculatePath(form, answers);
    const question = questions.find(q => q.id === activeId);
    const number = path.indexOf(activeId) + 1;
    const total = Math.max(longestPath, 1);
    const progress = done ? 100 : question ? Math.round((Math.max(number, 1) / total) * 100) : 0;
    const options = question ? choicesFor(question) : null;
    let content;
    if (done) {
      content = `<div class="thankyou"><h1 tabindex="-1">${preview ? 'Preview complete' : 'Thank you'}</h1>
        <p>${preview ? 'No response was recorded. Return to the editor to keep working.' : 'Your response has been submitted.'}</p></div>`;
    } else if (!question) {
      content = `<h1>${esc(form.title)}</h1><p class="desc">This form has no questions yet.</p>`;
    } else {
      const last = nextFor(question, answers[activeId], questions.indexOf(question)) === null;
      const action = submitting ? 'Submitting…' : last ? 'Submit' : 'Next';
      content = `<div class="public-count">Question ${number}${variableLength ? '' : ` of ${total}`}</div>
        ${number === 1 ? `<h1>${esc(form.title)}</h1>${form.description ? `<p class="desc">${esc(form.description)}</p>` : ''}` : ''}
        <h2 class="question-prompt" id="question-title" tabindex="-1">${esc(question.title || 'Question')}${question.required ? '<span class="required-mark" aria-hidden="true"> *</span>' : ''}</h2>
        ${answerControl(question, options)}
        <div class="public-error" id="answer-error" role="alert">${esc(errorMessage)}</div>
        <div class="public-controls">
          <button type="button" class="back-button" id="back" ${number <= 1 || submitting ? 'disabled' : ''}>Back</button>
          <button type="button" class="ok-button" id="next" ${submitting ? 'disabled' : ''}>${action}</button>
        </div>`;
    }
    app.innerHTML = DOMPurify.sanitize(`<main class="public-page${embedded ? ' embedded-form' : ''}" style="${css}">
      <div class="public-top"><div class="public-progress" role="progressbar" aria-label="Form progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" style="width:${progress}%"></div></div>
      <div class="public-inner">
        ${preview ? '<p class="preview-label">Preview mode</p>' : ''}
        ${design.logo ? `<div class="public-brand"><img data-public-logo src="${esc(design.logo)}" alt="${esc(form.title)} logo"></div>` : ''}
        <section class="public-content">${content}</section>
      </div></main>`);
    app.querySelector('[data-public-logo]')?.addEventListener('error', event => {
      event.currentTarget.closest('.public-brand').hidden = true;
    }, {once: true});
    if (done) {
      app.querySelector('.thankyou h1').focus();
      return;
    }
    if (!question) return;
    const answer = app.querySelector('#answer');
    const buttons = [...app.querySelectorAll('[data-choice]')];
    if (submitting) {
      app.querySelector('#question-title').focus();
      app.querySelector('#next').setAttribute('aria-live', 'polite');
    } else {
      const selected = preferredChoice ?? answers[question.id];
      const focus = answer || buttons.find(button => button.dataset.choice === selected)
        || buttons[0] || app.querySelector('#question-title');
      if (focusQuestion) focus.focus();
    }
    answer?.addEventListener('input', () => {
      answers[question.id] = answer.value;
      errorMessage = '';
      answer.removeAttribute('aria-invalid');
      answer.removeAttribute('aria-describedby');
      app.querySelector('#answer-error').textContent = '';
    });
    answer?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        advance();
      }
    });
    for (const button of buttons) {
      button.addEventListener('click', () => selectChoice(question, button.dataset.choice));
    }
    app.querySelector('#back').addEventListener('click', back);
    app.querySelector('#next').addEventListener('click', advance);
    app.querySelector('.public-page').addEventListener('keydown', event => {
      if (submitting || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey
        || event.metaKey || event.target.matches('input,textarea,select')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      } else if (options) {
        let index = -1;
        if (/^[1-9]$/.test(event.key)) index = Number(event.key) - 1;
        else if (/^[a-z]$/i.test(event.key)) index = event.key.toLowerCase().charCodeAt(0) - 97;
        const choice = options[index];
        if (choice !== undefined) {
          event.preventDefault();
          selectChoice(question, choice);
        }
      }
    });
  };
  const back = () => {
    if (submitting) return;
    const path = calculatePath(form, answers);
    const index = path.indexOf(activeId);
    if (index > 0) {
      activeId = path[index - 1];
      errorMessage = '';
      render();
    }
  };
  const advance = async () => {
    if (submitting || done) return;
    const question = questions.find(q => q.id === activeId);
    if (!question) return;
    const input = app.querySelector('#answer');
    if (input) answers[activeId] = input.value;
    else if (!Object.hasOwn(answers, activeId)) answers[activeId] = '';
    errorMessage = validateAnswer(question, answers[activeId]);
    if (errorMessage) {
      render();
      return;
    }
    const destination = nextFor(question, answers[activeId], questions.indexOf(question));
    discardSkippedAnswers();
    if (destination) {
      activeId = destination;
      render();
      return;
    }
    if (preview) {
      done = true;
      render();
      return;
    }
    submitting = true;
    render();
    const submittingView = app.firstElementChild;
    try {
      await api(`/api/public/forms/${encodeURIComponent(form.id)}/submit`, {method: 'POST', body: json({answers, version: form.version})});
      done = true;
    } catch (error) {
      errorMessage = error.message;
    } finally {
      submitting = false;
      if (app.firstElementChild === submittingView) render();
    }
  };
  render(undefined, !embedded);
}

function responseTable(questions, responses) {
  const heading = questions.map(q => `<th>${esc(q.title)}</th>`).join('');
  const rows = responses.map(response => {
    const cells = questions.map(q => `<td data-label="${esc(q.title)}">${esc(response.answers[q.id] ?? '')}</td>`).join('');
    return `<tr><td data-label="Submitted">${esc(formatDateTime(response.submittedAt))} UTC</td>${cells}</tr>`;
  }).join('');
  return `<div class="responses-table-wrap"><table class="responses-table">
    <thead><tr><th>Submitted</th>${heading}</tr></thead><tbody>${rows}</tbody>
  </table></div>`;
}

async function responsesView(id) {
  const endpoint = `/api/forms/${encodeURIComponent(id)}/responses/query`;
  const query = values => api(endpoint, {method:'POST',body:json(values)});
  const emptyFilters = {search:'',from:'',to:''};
  try {
    const [form, initial] = await Promise.all([api(`/api/forms/${encodeURIComponent(id)}`), query({})]);
    if (location.pathname !== `/responses/${encodeURIComponent(id)}`) return;
    app.innerHTML = DOMPurify.sanitize(`<main class="shell">
      ${header(`<button class="button" data-nav="/edit/${esc(form.id)}">Edit form</button><button class="button" data-nav="/">Dashboard</button>`)}
      <section class="responses-head"><div><p class="eyebrow">Responses</p><h1 class="page-title">${esc(form.title)}</h1></div></section>
      <form id="response-filters" class="panel response-filters">
        <div class="response-filter-fields">
          <div class="field"><label for="response-search">Search answers</label><input id="response-search" name="search" type="search" maxlength="200" placeholder="Name, email or answer"></div>
          <div class="field"><label for="response-from">From date (UTC)</label><input id="response-from" name="from" type="date"></div>
          <div class="field"><label for="response-to">To date (UTC)</label><input id="response-to" name="to" type="date"></div>
        </div>
        <div class="response-actions">
          <button class="button" type="submit">Apply filters</button><button class="button ghost" id="clear-response-filters" type="button">Clear filters</button>
        </div>
      </form>
      <p id="response-error" class="error" role="alert" tabindex="-1" hidden></p>
      <div class="response-results-bar">
        <p id="response-count" class="muted" role="status"></p>
        <button class="button primary" id="export" type="button">Export CSV</button>
      </div>
      <div id="response-results"></div>
      <nav class="response-pagination" aria-label="Response pages" hidden>
        <button class="button" id="previous-response-page" type="button">Previous page</button>
        <span id="response-page-number" class="muted"></span>
        <button class="button" id="next-response-page" type="button">Next page</button>
      </nav>
    </main>`);
    const filters = document.querySelector('#response-filters');
    const error = document.querySelector('#response-error');
    const count = document.querySelector('#response-count');
    const results = document.querySelector('#response-results');
    const pager = document.querySelector('.response-pagination');
    const previous = document.querySelector('#previous-response-page');
    const next = document.querySelector('#next-response-page');
    const pageNumber = document.querySelector('#response-page-number');
    const exportButton = document.querySelector('#export');
    let active = emptyFilters;
    let data = initial;
    let page = 1;
    let pending = false;

    const showError = message => {
      error.textContent = message;
      error.hidden = !message;
      if (message) error.focus();
    };
    const render = () => {
      const filtered = Boolean(active.search || active.from || active.to);
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      count.textContent = `${data.total} ${filtered ? 'matching' : 'completed'} ${data.total === 1 ? 'response' : 'responses'}`;
      exportButton.disabled = pending || data.total === 0;
      previous.disabled = pending || page === 1;
      next.disabled = pending || page >= pages;
      pager.hidden = pages === 1;
      pageNumber.textContent = `Page ${page} of ${pages}`;
      results.innerHTML = DOMPurify.sanitize(data.responses.length
        ? responseTable(data.questions, data.responses)
        : filtered
          ? '<section class="empty"><h2>No matching responses</h2><p>Change your search or clear the filters to see other responses.</p></section>'
          : '<section class="empty"><h2>No responses yet</h2><p>Completed submissions will appear here.</p></section>');
    };
    const load = async (values, requestedPage = 1, moveFocus = false) => {
      if (pending) return;
      pending = true;
      showError('');
      exportButton.disabled = true;
      try {
        const updated = await query({...values,page:requestedPage});
        if (!results.isConnected) return;
        data = updated;
        active = values;
        page = requestedPage;
      } catch (loadError) {
        if (results.isConnected) showError(loadError.message);
      } finally {
        pending = false;
        if (results.isConnected) {
          render();
          if (moveFocus && error.hidden) {
            const target = requestedPage > 1 && !previous.disabled ? previous : next;
            target.focus();
          }
        }
      }
    };
    filters.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(filters));
      load({...values,search:values.search.trim()});
    });
    document.querySelector('#clear-response-filters').onclick = () => {
      if (pending) return;
      filters.reset();
      load(emptyFilters);
    };
    previous.onclick = () => load(active, page - 1, true);
    next.onclick = () => load(active, page + 1, true);
    exportButton.onclick = async () => {
      if (pending || data.total === 0) return;
      pending = true;
      exportButton.disabled = true;
      showError('');
      try {
        const exported = await query({...active,exportAll:true});
        if (!results.isConnected) return;
        if (exported.total === 0) return showError('No matching responses are available to export.');
        downloadCsv(form, exported.questions, exported.responses);
      } catch (exportError) {
        if (results.isConnected) showError(exportError.message);
      } finally {
        pending = false;
        if (results.isConnected) {
          render();
          if (error.hidden) exportButton.focus();
        }
      }
    };
    render();
  } catch (error) {
    if (error.status === 401) return loginView();
    app.innerHTML = DOMPurify.sanitize(`<main class="shell"><p class="error">${esc(error.message)}</p></main>`);
  }
}
function downloadCsv(form,questions,responses) {
  const safeCell=value=>{
    const text=String(value??'');
    const plainNumber=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
    return (/^[=+@\t\r-]/.test(text)&&!plainNumber)?`'${text}`:text;
  };
  const quote=value=>`"${safeCell(value).replace(/"/g,'""')}"`;
  const rows=[['Submitted',...questions.map(q=>q.title)],...responses.map(response=>[response.submittedAt,...questions.map(q=>response.answers[q.id]??'')])];
  const csv='\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${(form.title||'responses').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-|-$/g,'')||'responses'}.csv`;link.click();URL.revokeObjectURL(url);
}

document.addEventListener('click',event=>{const link=event.target.closest('[data-nav]');if(link){event.preventDefault();go(link.dataset.nav)}});
route();
