const navItems=[['overview','Overview','grid'],['services','Services','box'],['playground','Playground','flask'],['receipts','Receipts','receipt'],['policy','Policy explorer','circuit']];
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
for(const nav of document.querySelectorAll('.top-links,.side-links')) nav.innerHTML=navItems.map(([id,label,glyph])=>`<button class="nav-link" data-go="${id}" title="${label}" aria-label="${label}" ${id==='overview'?'aria-current="page"':''}>${icon(glyph)}<span class="link-label">${label}</span></button>`).join('');
const catalog=document.querySelector('#service-catalog');
for(const card of document.querySelectorAll('.card-grid .service-card')) catalog.append(card.cloneNode(true));
let activeView='overview';
const titles={overview:['Your workspace','Give every agent a budget. Keep every request in view.'],services:['Your services','Useful tools. Published prices. A little more certainty.'],playground:['Playground','Try a small idea before it becomes a bigger one.'],receipts:['Your receipts','A clear record of every result and every payment.'],policy:['Your payment policy','Your spending rules, made a little easier to see.']};
function navigate(view){
  activeView=view;
  document.querySelector('#page-title').textContent=titles[view][0];
  document.querySelector('#page-description').textContent=titles[view][1];
  document.querySelectorAll('.nav-link').forEach(link=>{if(link.dataset.go===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.querySelector('#overview-view').hidden=view!=='overview';
  document.querySelectorAll('.extra-view').forEach(section=>section.hidden=section.id!==view+'-view');
  document.querySelector('#receipts-section').hidden=!['overview','receipts'].includes(view);
  document.querySelector('#receipt-title').textContent=view==='receipts'?'Every request, accounted for':'A trail you can follow';
  document.querySelector('.top-links [aria-current=page]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  filterSearch();
}
function setLayout(layout){
  document.body.dataset.layout=layout;
  document.querySelectorAll('[data-layout-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.layoutChoice===layout)));
  const url=new URL(location.href);url.searchParams.set('layout',layout);history.replaceState(null,'',url);
  document.title=`emeter — ${layout==='sidebar'?'Sidebar':'Top navigation'} preview`;
}
setLayout(new URL(location.href).searchParams.get('layout')==='sidebar'?'sidebar':'top');
document.querySelectorAll('[data-layout-choice]').forEach(button=>button.addEventListener('click',()=>setLayout(button.dataset.layoutChoice)));
document.addEventListener('click',event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(target.dataset.go)navigate(target.dataset.go);
  if(target.classList.contains('brand')){event.preventDefault();navigate('overview');}
  if(target.dataset.message)toast(target.dataset.message);
  if(target.classList.contains('new-session'))document.querySelector('#session-dialog').showModal();
  if(target.classList.contains('close-dialog'))target.closest('dialog').close();
  if(target.dataset.detail)showDetail(target.dataset.detail);
});
let toastTimer;
function toast(message){clearTimeout(toastTimer);const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');toastTimer=setTimeout(()=>el.classList.remove('visible'),4200);}
document.querySelector('#notifications').addEventListener('click',()=>toast('All caught up. These are example notifications.'));
document.querySelector('#date-filter').addEventListener('click',()=>toast('Showing this week’s example activity.'));
document.querySelector('#session-form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget);document.querySelector('#session-dialog').close();toast(`Preview session “${data.get('name')}” created with a ${Number(data.get('budget')).toFixed(2)} DEMO budget.`);});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
function showDetail(type){
  const content=document.querySelector('#detail-content');
  const rows=type==='session'?[['Budget','0.50 DEMO'],['Spent','0.09 DEMO'],['Remaining','0.41 DEMO'],['Per-request maximum','0.05 DEMO'],['Service scope','JSON Validator + AI Text Analyzer']]:[['Service',type==='ai'?'AI Text Analyzer':'JSON Validator'],['Price',type==='ai'?'0.05 DEMO':'0.02 DEMO'],['Session','Research assistant'],['Status','Settled · example'],['Provider signature','Example verified state']];
  content.replaceChildren();const heading=document.createElement('h2');heading.textContent=type==='session'?'Research assistant':'A little proof of what happened.';content.append(heading);
  for(const[label,value]of rows){const row=document.createElement('div');row.className='detail-line';const span=document.createElement('span');span.textContent=label;const strong=document.createElement('strong');strong.textContent=value;row.append(span,strong);content.append(row);}
  document.querySelector('#detail-dialog').showModal();
}
function filterSearch(){const term=document.querySelector('#search').value.toLowerCase().trim();let matches=0;document.querySelectorAll('[data-search]').forEach(el=>{const match=el.dataset.search.includes(term);el.hidden=!match;if(match)matches++;});document.querySelector('#no-results').hidden=!term||matches>0;}
document.querySelector('#search').addEventListener('input',filterSearch);
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();document.querySelector('#search').focus();}});
document.querySelector('#validate').addEventListener('click',()=>{const out=document.querySelector('#json-output');try{const value=JSON.parse(document.querySelector('#json-input').value);out.textContent=JSON.stringify({valid:true,value},null,2);}catch{out.textContent=JSON.stringify({valid:false,error:'This example is not valid JSON.'},null,2);}});
function updatePolicy(){const allowed=document.querySelector('#within-limit').checked||document.querySelector('#override').checked;const result=document.querySelector('#policy-result');result.textContent=allowed?'Payment allowed':'Payment denied';result.classList.toggle('denied',!allowed);}
document.querySelectorAll('.policy-switches input').forEach(input=>input.addEventListener('change',updatePolicy));
