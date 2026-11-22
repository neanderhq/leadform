import { validEmail } from './validation.js';
const app = document.querySelector('#app');
const questionTypes = [['short','Short text'],['email','Email'],['number','Number'],['multiple','Multiple choice'],['yesno','Yes / No'],['rating','Rating (1–5)']];
const defaults = { primary:'#5366d8', background:'#f7f7f5', text:'#202124', logo:'' };
let currentForm = null;
let saveTimer;
let editorDirty = false;
let currentRoute = location.pathname;
const esc = (value='') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const api = async (url, options={}) => {
  const response = await fetch(url, { ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers||{}) } });
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
function formatDateTime(value) { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
function header(actions='') { return `<header class="topbar"><a class="wordmark" href="/" data-nav="/">Leadform</a><div class="top-actions">${actions}</div></header>`; }
function showToast(message) { const node=document.createElement('div');node.className='toast';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),2100); }

async function route() {
  const pathname=location.pathname;
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
    app.innerHTML=DOMPurify.sanitize(`<main class="shell">${header('<button class="button ghost" id="logout">Sign out</button>')}<section class="dashboard-head"><div><p class="eyebrow">Workspace</p><h1 class="page-title">Your forms</h1><p class="intro muted">Create a form and gather the responses that matter.</p></div><button class="button primary" id="create">＋ Create form</button></section>${forms.length?`<section class="form-list">${forms.map(form=>`<article class="form-card"><div><h2 class="form-title">${esc(form.title)}</h2><div class="form-meta">${form.response_count} ${form.response_count===1?'response':'responses'} · Created ${formatDate(form.created_at)}</div></div><div class="row-actions"><button class="button small" data-response="${form.id}">View responses</button><button class="button small" data-edit="${form.id}">Edit</button><button class="button small danger" data-delete="${form.id}">Delete</button></div></article>`).join('')}</section>`:`<section class="empty"><h2>No forms yet</h2><p>Create your first form to start collecting responses.</p><button class="button primary" id="create-empty">Create your first form</button></section>`}</main>`);
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
function renderEditor() {
  const form=currentForm;form.design={...defaults,...form.design};form.questions ||= [];
  editorDirty=false;
  app.innerHTML=DOMPurify.sanitize(`<main class="shell editor-shell"><header class="editor-head"><div><button class="button ghost" data-nav="/">← Dashboard</button><div class="editor-title">Edit form</div></div><div class="top-actions"><button class="button" id="preview">Preview</button><button class="button" id="copy-link">Copy link</button><div class="save-control"><button class="button primary" id="save">Save</button><div id="save-state" class="save-state" role="status"></div></div></div></header><div class="editor-layout"><section><div class="panel"><div class="field"><label for="form-title">Form title</label><input id="form-title" class="control" value="${esc(form.title)}" maxlength="200"></div><div class="field"><label for="form-description">Description</label><textarea id="form-description" class="control">${esc(form.description)}</textarea></div></div><div class="panel" style="margin-top:16px"><p class="section-label">Questions</p><div id="questions">${form.questions.map((q,i)=>questionTemplate(q,i,form.questions)).join('')}</div><button class="button" id="add-question">＋ Add question</button></div></section><aside class="panel side-panel"><p class="section-label">Design</p><div class="color-row"><label for="primary-color">Primary color</label><input type="color" id="primary-color" value="${esc(form.design.primary)}"></div><div class="color-row"><label for="background-color">Background</label><input type="color" id="background-color" value="${esc(form.design.background)}"></div><div class="color-row"><label for="text-color">Text color</label><input type="color" id="text-color" value="${esc(form.design.text)}"></div><div class="field" style="margin-top:18px"><label for="logo-url">Logo image URL</label><input id="logo-url" class="control" type="url" placeholder="https://…" value="${esc(form.design.logo)}"><div class="logo-preview-wrap"><img id="logo-preview" alt="Logo preview"><span id="logo-preview-empty">Logo preview appears here</span></div></div><p class="hint">Changes appear in preview and on your public form after you save.</p></aside></div></main>`);
  const getSnapshot=()=>editorSnapshot();
  const saveState=document.querySelector('#save-state');
  const markUnsaved=()=>{editorDirty=true;saveState.textContent='Unsaved changes';saveState.className='save-state';document.querySelectorAll('[data-question-error]').forEach(error=>error.textContent='');};
  const updateLogoPreview=()=>{
    const image=document.querySelector('#logo-preview');
    const empty=document.querySelector('#logo-preview-empty');
    image.hidden=true;
    empty.hidden=false;
    image.onload=()=>{image.hidden=false;empty.hidden=true;};
    image.onerror=()=>{image.hidden=true;empty.hidden=false;};
    const url=document.querySelector('#logo-url').value;
    if(url)image.src=url;else image.removeAttribute('src');
  };
  const renderQuestions=()=>{document.querySelector('#questions').innerHTML=DOMPurify.sanitize(currentForm.questions.map((q,i)=>questionTemplate(q,i,currentForm.questions)).join(''));attachQuestionEvents();};
  const attachQuestionEvents=()=>{
    document.querySelectorAll('.question-card').forEach(card=>{
      card.querySelector('[data-type]').onchange=()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.type=card.querySelector('[data-type]').value;if(q.type==='multiple'&&!q.options?.length)q.options=['Option 1','Option 2'];markUnsaved();renderQuestions()};
      card.querySelector('[data-qtitle]').oninput=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.title=event.target.value;markUnsaved()};
      card.querySelector('[data-required]').onchange=event=>{currentForm.questions.find(item=>item.id===card.dataset.question).required=event.target.checked;markUnsaved()};
      card.querySelectorAll('[data-option]').forEach(input=>input.oninput=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);const index=Number(event.target.dataset.option);const previous=q.options[index];const next=event.target.value;if(previous!==next){if(Object.hasOwn(q.rules||{},previous)){q.rules[next]=q.rules[previous];delete q.rules[previous]}const branch=[...card.querySelectorAll('[data-rule]')].find(select=>select.dataset.rule===previous);if(branch){branch.dataset.rule=next;branch.setAttribute('aria-label',`If ${next}, go to`);branch.previousElementSibling.textContent=next}}q.options[index]=next;markUnsaved()});
      card.querySelectorAll('[data-rule]').forEach(select=>select.onchange=event=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.rules={...q.rules,[event.target.dataset.rule]:event.target.value};markUnsaved()});
      card.querySelector('[data-default-next]')?.addEventListener('change',event=>{currentForm.questions.find(item=>item.id===card.dataset.question).defaultNext=event.target.value;markUnsaved()});
      card.querySelector('[data-add-option]')?.addEventListener('click',()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);q.options.push(`Option ${q.options.length+1}`);markUnsaved();renderQuestions()});
      card.querySelectorAll('[data-remove-option]').forEach(button=>button.onclick=()=>{const q=currentForm.questions.find(item=>item.id===card.dataset.question);const index=Number(button.dataset.removeOption);delete q.rules?.[q.options[index]];q.options.splice(index,1);markUnsaved();renderQuestions()});
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
    markUnsaved();renderQuestions();
    if(removedRules)showToast('Removed backward branch rules. They now use the default next step.');
  };
  attachQuestionEvents();
  document.querySelector('#add-question').onclick=()=>{currentForm.questions.push({id:crypto.randomUUID(),title:'',type:'short',required:false,options:[],rules:{},defaultNext:''});markUnsaved();renderQuestions()};
  document.querySelector('#save').onclick=async()=>{
    document.querySelectorAll('[data-question-error]').forEach(error=>error.textContent='');
    try{const saved=await api(`/api/forms/${form.id}`,{method:'PUT',body:json(getSnapshot())});currentForm=saved;editorDirty=false;saveState.textContent='Saved';saveState.className='save-state ok';showToast('Saved')}
    catch(error){saveState.textContent=error.message;saveState.className='save-state error';const questionIndex=error.body?.questionIndex;if(Number.isInteger(questionIndex)){const card=document.querySelectorAll('.question-card')[questionIndex];const questionError=card?.querySelector('[data-question-error]');if(questionError)questionError.textContent=error.message;card?.scrollIntoView({behavior:'smooth',block:'center'});}}
  };
  document.querySelectorAll('#form-title,#form-description,#primary-color,#background-color,#text-color').forEach(input=>input.addEventListener('input',markUnsaved));
  document.querySelector('#logo-url').addEventListener('input',()=>{markUnsaved();updateLogoPreview()});
  updateLogoPreview();
  document.querySelector('#preview').onclick=()=>{const draft=getSnapshot();sessionStorage.setItem('leadform-preview',json(draft));window.open(`/preview/${draft.id}`,'_blank')};
  document.querySelector('#copy-link').onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}/f/${form.id}`);showToast('Public link copied')};
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
async function publicView(id,preview) {
  let form;
  if(preview){try{form=JSON.parse(sessionStorage.getItem('leadform-preview')||'null');if(!form||form.id!==id)throw new Error('Preview is no longer available')}catch(error){app.innerHTML=DOMPurify.sanitize(`<main class="shell"><p>${esc(error.message)}</p></main>`);return}}
  else {try{form=await api(`/api/public/forms/${encodeURIComponent(id)}`)}catch(error){app.innerHTML=DOMPurify.sanitize(`<main class="shell"><section class="empty"><h2>Form not found</h2><p>This form may have been deleted or the link may be incorrect.</p></section></main>`);return}}
  mountRespondent(form,preview);
}
function mountRespondent(form,preview) {
  const questions=form.questions||[];const answers={};let activeId=questions[0]?.id||null;let done=false;let errorMessage='';let selectedChoice=null;
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
  const render=()=>{
    const path=calculatePath(form,answers);const question=questions.find(q=>q.id===activeId);const number=path.indexOf(activeId)+1;const total=Math.max(longestPath,1);const progress=done?100:question?Math.round((Math.max(number,1)/total)*100):0;
    app.innerHTML=DOMPurify.sanitize(`<main class="public-page" style="${css}"><div class="public-top"><div class="public-progress" role="progressbar" aria-label="Form progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" style="width:${progress}%"></div></div><div class="public-inner"><div class="public-brand">${design.logo?`<img data-public-logo src="${esc(design.logo)}" alt="${esc(form.title)} logo">`:''}</div>${done?`<section class="public-content thankyou" role="status"><h1>Thank you</h1><p>Your response has been submitted.</p></section>`:!questions.length?`<section class="public-content"><h1>${esc(form.title)}</h1><p class="desc">This form has no questions yet.</p></section>`:`<section class="public-content"><div class="public-count">Question ${number} of ${total}</div>${number===1?`<h1>${esc(form.title)}</h1>${form.description?`<p class="desc">${esc(form.description)}</p>`:''}`:''}<h2 class="question-prompt">${esc(question?.title||'Question')}${question?.required?'<span class="required-mark"> *</span>':''}</h2>${question?.type==='multiple'||question?.type==='yesno'?`<div class="choice-list">${(question.type==='multiple'?question.options||[]:['Yes','No']).map((choice,index)=>`<button type="button" class="choice ${answers[question.id]===choice?'selected':''}" aria-pressed="${answers[question.id]===choice}" data-choice="${esc(choice)}"><span class="choice-key">${index<9?index+1:''}</span>${esc(choice)}</button>`).join('')}</div>`:question?.type==='rating'?`<div class="rating-list">${[1,2,3,4,5].map(value=>`<button type="button" class="choice ${answers[question.id]===String(value)?'selected':''}" aria-pressed="${answers[question.id]===String(value)}" data-choice="${value}">${value}</button>`).join('')}</div>`:`<input class="answer-input" id="answer" type="${question?.type==='email'?'email':'text'}" ${question?.type==='number'?'inputmode="decimal"':''} value="${esc(answers[question?.id]||'')}" aria-label="${esc(question?.title||'Your answer')}" autocomplete="${question?.type==='email'?'email':'off'}" placeholder="Type your answer here…">`}<div class="public-error" role="alert">${esc(errorMessage)}</div></section>`}<footer class="public-bottom">${!done&&questions.length?`<span class="muted mobile-hidden">${preview?'Preview mode':''}</span><div class="public-controls"><button type="button" class="back-button" id="back" ${number<=1?'disabled':''}>Back</button><button type="button" class="ok-button" id="next">${nextFor(question,answers[question?.id],questions.indexOf(question))===null?'Submit':'OK'} <span aria-hidden="true">↵</span></button></div>`:`<span></span>`}</footer></div></main>`);
    document.querySelector('[data-public-logo]')?.addEventListener('error',event=>{event.currentTarget.hidden=true;},{once:true});
    const answerInput=document.querySelector('#answer');if(answerInput){answerInput.focus();answerInput.addEventListener('input',()=>{answers[question.id]=answerInput.value;errorMessage=''});answerInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();advance()}})}
    document.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>{selectedChoice=button.dataset.choice;answers[question.id]=selectedChoice;errorMessage='';const currentPath=calculatePath(form,answers);const reachable=new Set(currentPath);for(const key of Object.keys(answers))if(!reachable.has(key))delete answers[key];render();document.querySelector(`[data-choice="${CSS.escape(selectedChoice)}"]`)?.focus()});
    document.querySelector('#back')?.addEventListener('click',back);
    document.querySelector('#next')?.addEventListener('click',advance);
  };
  const back=()=>{const path=calculatePath(form,answers);const index=path.indexOf(activeId);if(index>0){activeId=path[index-1];errorMessage='';render()}};
  const advance=async()=>{
    const path=calculatePath(form,answers);const question=questions.find(q=>q.id===activeId);if(!question)return;
    const input=document.querySelector('#answer');if(input)answers[question.id]=input.value;
    if(['multiple','yesno','rating'].includes(question.type)&&!(question.id in answers))answers[question.id]='';
    const validation=validateAnswer(question,answers[question.id]);if(validation){errorMessage=validation;render();document.querySelector('#answer')?.focus();return}
    if((question.type==='multiple'||question.type==='yesno'||question.type==='rating')&&question.required&&!answers[question.id]){errorMessage='This question is required';render();return}
    const destination=nextFor(question,answers[question.id],questions.indexOf(question));
    const reachable=new Set(calculatePath(form,answers));for(const key of Object.keys(answers))if(!reachable.has(key))delete answers[key];
    if(destination){activeId=destination;errorMessage='';render();return}
    if(preview){done=true;render();return}
    try{await api(`/api/public/forms/${encodeURIComponent(form.id)}/submit`,{method:'POST',body:json({answers})});done=true;render()}
    catch(error){errorMessage=error.message;render()}
  };
  document.addEventListener('keydown',event=>{
    if(!app.querySelector('.public-page')||done||event.target.matches('input,textarea,select'))return;
    const question=questions.find(q=>q.id===activeId);if(!question)return;
    if(event.key==='Enter'){event.preventDefault();advance();return}if(event.key==='ArrowLeft'){back();return}
    const options=question.type==='multiple'?question.options||[]:question.type==='yesno'?['Yes','No']:question.type==='rating'?['1','2','3','4','5']:[];
    let optionIndex=-1;if(/^[1-9]$/.test(event.key))optionIndex=Number(event.key)-1;else if(/^[a-z]$/i.test(event.key))optionIndex=event.key.toLowerCase().charCodeAt(0)-97;
    if(optionIndex>=0&&optionIndex<options.length){answers[question.id]=String(options[optionIndex]);errorMessage='';const path=calculatePath(form,answers);const reachable=new Set(path);for(const key of Object.keys(answers))if(!reachable.has(key))delete answers[key];render()}
  });
  render();
}

async function responsesView(id) {
  try {
    const [form,data]=await Promise.all([api(`/api/forms/${id}`),api(`/api/forms/${id}/responses`)]);
    const questions=data.questions;const responses=data.responses;
    app.innerHTML=DOMPurify.sanitize(`<main class="shell">${header(`<button class="button" data-nav="/edit/${form.id}">Edit form</button><button class="button" data-nav="/">Dashboard</button>`)}<section class="responses-head"><div><p class="eyebrow">Responses</p><h1 class="page-title">${esc(form.title)}</h1><p class="intro muted">${responses.length} completed ${responses.length===1?'response':'responses'}</p></div><button class="button primary" id="export" ${responses.length?'':'disabled'}>Export CSV</button></section>${responses.length?`<div class="responses-table-wrap"><table class="responses-table"><thead><tr><th>Submitted</th>${questions.map(q=>`<th>${esc(q.title)}</th>`).join('')}</tr></thead><tbody>${responses.map(response=>`<tr><td data-label="Submitted">${esc(formatDateTime(response.submittedAt))}</td>${questions.map(q=>`<td data-label="${esc(q.title)}">${esc(response.answers[q.id]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<section class="empty"><h2>No responses yet</h2><p>Completed submissions will appear here.</p></section>`}</main>`);
    document.querySelector('#export').onclick=()=>downloadCsv(form,questions,responses);
  }catch(error){if(error.status===401)return loginView(false);app.innerHTML=DOMPurify.sanitize(`<main class="shell"><p class="error">${esc(error.message)}</p></main>`)}
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
