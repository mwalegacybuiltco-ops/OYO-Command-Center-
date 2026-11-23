'use strict';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = (date = new Date()) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
const asDate = key => new Date(key+'T12:00:00');
function addDays(key, count) {
  const date = asDate(key);
  date.setDate(date.getDate()+count);
  return dateKey(date);
}
const readable = key => asDate(key).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
const weekStart = key => addDays(key,-((asDate(key).getDay()+6)%7));
const storageKey = 'april-growth-command-v1';
const empty = () => ({events:[],people:[],checks:{},corners:{}});
let data = {LWA:empty(),OYO:empty()};
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) data = JSON.parse(saved);
} catch { notify('Saved records could not be loaded. Check your backup.'); }
let business = 'LWA', tab = 'Today', day = dateKey(), query = '', roleFilter = '', stageFilter = '';
const stages = ['New', 'In conversation', 'Invited', 'Call booked', 'Decision pending', 'Won', 'Closed', 'On hold'];
const directions=['Unclassified','Inbound','Outbound'];
const sources=['Own lead','Setter / referral','Other'];
const leadRole=role=>['Prospect','Inquiry','Client'].includes(role);
let directionFilter='', sourceFilter='';
function socialHref(value) {
  const text=String(value||'').trim();
  if (!/^(https?:\/\/|(?:(?:www|m|vm|vt)\.)?(?:facebook|instagram|tiktok|linkedin|threads|youtube)\.com\/)/i.test(text)) return '';
  try {
    const url=new URL(/^https?:/i.test(text)?text:'https://'+text);
    return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';
  } catch { return ''; }
}
function socialMarkup(person) {
  const links=(person.social||'').split(/\s*\|\s*/).filter(Boolean);
  return links.length?'<p class="social">'+links.map(value=>{
    const href=socialHref(value);
    return href?'<a href="'+escape(href)+'" target="_blank" rel="noopener noreferrer">'+escape(value)+'</a>':'<span>'+escape(value)+'</span>';
  }).join('')+'</p>':'';
}
const memberRole = role => ['Growth Partner member','LWA member'].includes(role);
const cadenceOptions = [['0','Manual only'],['7','Weekly'],['14','Every 2 weeks'],['30','Every 30 days']];
const cadenceLabel = cadence => cadenceOptions.find(([value])=>Number(value)===Number(cadence))?.[1] || 'Manual only';

function nextWeekday(key) {
  while ([0,6].includes(asDate(key).getDay())) key = addDays(key,1);
  return key;
}

const weeklyCap = () => Math.min(10,Math.max(5,Number(db().memberWeeklyCap)||5));

function memberSlot(date) {
  let candidate=nextWeekday(date);
  while(true){
    const week=weekStart(candidate);
    const scheduled=db().events.filter(event=>event.memberCheckIn&&event.date>=week&&event.date<addDays(week,7));
    if(scheduled.length<weeklyCap()){
      const days=[];
      for(let key=candidate;weekStart(key)===week&&asDate(key).getDay()!==6;key=addDays(key,1)){
        days.push({key,count:scheduled.filter(event=>event.date===key).length});
      }
      if(days.length)return days.sort((a,b)=>a.count-b.count)[0].key;
    }
    candidate=addDays(week,7);
  }
}

function validContactDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(asDate(value).getTime())&&dateKey(asDate(value))===value&&value<=dateKey();
}

function lastContactFromNotes(notes, today=dateKey()) {
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const patterns=/\b(\d{4}-\d{2}-\d{2})\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  const dates=[];
  for(const [,iso,month,day,year] of notes.matchAll(patterns)){
    const suffix=month?'-'+String(months.indexOf(month.toLowerCase().slice(0,3))+1).padStart(2,'0')+'-'+day.padStart(2,'0'):'';
    let key=iso||(year||today.slice(0,4))+suffix;
    if(!iso&&!year&&key>today) key=String(Number(today.slice(0,4))-1)+suffix;
    if(key<=today&&Number.isFinite(asDate(key).getTime())&&dateKey(asDate(key))===key) dates.push(key);
  }
  return dates.sort().at(-1)||'';
}

function queueMembers(people, cadence, start) {
  const dateFor=person=>[person.lastContact||'',...(person.conversations||[]).map(log=>log.date)].filter(validContactDate).sort().at(-1);
  const queue=people.filter(person=>!db().events.some(event=>event.memberCheckIn&&event.person===person.id&&!event.done))
    .map(person=>({person,last:dateFor(person)}))
    .sort((a,b)=>(a.last||'9999').localeCompare(b.last||'9999')||a.person.name.localeCompare(b.person.name));
  for(const {person,last} of queue){
    person.cadence=cadence;
    const due=last?addDays(last,cadence):start;
    memberPlan(person,memberSlot(due>start?due:start));
  }
  return queue.length;
}

function memberPlan(person, date) {
  const existing = db().events.find(event=>event.memberCheckIn && event.person===person.id && !event.done);
  if (!memberRole(person.role) || ![7,14,30].includes(person.cadence)) {
    if (existing) db().events=db().events.filter(event=>event.id!==existing.id);
    return;
  }
  const dateToUse = nextWeekday(date);
  if (existing) {
    existing.date=dateToUse;
    existing.title='Check in with '+person.name;
    return;
  }
  db().events.push({id:crypto.randomUUID(),person:person.id,title:'Check in with '+person.name,type:'Member check-in',date:dateToUse,time:'',status:'Planned',notes:'',done:false,memberCheckIn:true});
}

function finishMemberCheckIn(previous, current) {
  if (previous.done || !current.done || !current.memberCheckIn) return;
  const person=db().people.find(p=>p.id===current.person);
  if (person?.cadence) {
    person.lastContact=[person.lastContact||'',dateKey()].sort().at(-1);
    memberPlan(person,memberSlot(addDays(dateKey(),person.cadence)));
  }
}

const db = () => data[business];
const config = {
  LWA:{title:'LWA Growth', intro:'Stay on top of member check-ins, prospect follow-ups and booked calls.', roles:['Growth Partner member','LWA member','Prospect','Setter / referral partner'], types:['Reach-out','Follow-up','Member check-in','Sales call','Masterclass invite','Post'], corners:[
    ['Visibility & content','7:00 am · Publish a value post or story.','Batch this week’s posts.','Publish a practical skills post.','Share a midlife or RV story.','Publish a coaching or mentorship post.','Publish an offer with one clear CTA.','Share a story or live invitation.','Plan next week’s content.'],
    ['Conversations & outreach','8:00 am · Reply to inbound messages and start 3 conversations.','Check in with Growth Partner members.','Invite warm leads to the masterclass.','Start 3 new conversations.','Check in with Growth Partner members.','Touch base with setters on handoffs.','Reply to live or masterclass interest.','Review who needs a check-in.'],
    ['Follow-ups & sales','11:30 am · Clear due follow-ups and confirm booked calls.','Follow up with open prospects.','Confirm calls and invitees.','Follow up with attendees and no-shows.','Hold planned sales call block.','Update outcomes and next dates.','Follow up with warm replies.','Review upcoming calls.'],
    ['Support & business review','3:00 pm · Log outcomes and set the next action.','Ask members what they’re implementing this week.','Share a training resource when useful.','Check on members who asked for help.','Review progress with Growth Partner members.','Review posts, conversations, calls and sales.','Record any commitments.','Choose next week’s top 3 priorities.']
  ]},
  OYO:{title:'OYO Technologies',intro:'Keep inquiries, client work and product visibility moving in a focused block.', roles:['Inquiry','Prospect','Client','Collaborator'],types:['Reach-out','Follow-up','Discovery call','Project milestone','Post','Payment follow-up'],corners:[
    ['Visibility & content','Share or prepare the next OYO post.','Choose a demo to feature.','Post an app demo in the OYO Facebook group.','Capture a short screen recording.','Draft a practical business systems tip.','Share a client workflow or PWA use case.','Collect content ideas.','Plan next week’s posts.'],
    ['Conversations & outreach','Reply to inquiries and clarify the next step.','Review new inquiries.','Reply to demo questions.','Check in with warm prospects.','Invite a qualified prospect to a discovery call.','Review open conversations.','Check for new replies.','Review next week’s inquiries.'],
    ['Follow-ups & sales','Check quote, approval and payment follow-ups.','Review outstanding quotes.','Follow up on sent proposals.','Hold a discovery call block if booked.','Check approvals and outstanding payments.','Update deal status and next dates.','Check for client responses.','Review next week’s pipeline.'],
    ['Delivery & business review','Move one active project or PWA forward.','Choose the week’s delivery priority.','Work on one ready-made or personalized PWA.','Check client feedback and revisions.','Test or deliver the next milestone.','Review work delivered and revenue received.','Organize project notes.','Choose next week’s top 3 priorities.']
  ]}
};
const current = () => config[business];
const options = (values, selected) => values.map(value => '<option'+(value===selected?' selected':'')+'>'+escape(value)+'</option>').join('');
function notify(message) {
  $('notice').textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $('notice').textContent='', 4200);
}
function save(message) {
  try { localStorage.setItem(storageKey,JSON.stringify(data)); }
  catch { notify('Storage is unavailable or full. Export a backup before closing.'); render(); return; }
  render();
  if (message) notify(message);
}
function button(label, action, arg='', cls='') {
  return '<button type="button" class="'+cls+'" data-action="'+action+'" data-arg="'+escape(arg)+'">'+escape(label)+'</button>';
}
function nav(items, action, selected) {
  return items.map(item => '<button data-action="'+action+'" data-arg="'+item+'" aria-pressed="'+(item===selected)+'">'+item+'</button>').join('');
}
function sortedEvents() {
  return [...db().events].sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
}
function eventRow(event) {
  const person = db().people.find(p=>p.id===event.person);
  const overdue = !event.done && event.date < dateKey();
  const time = event.time ? new Date(event.date+'T'+event.time).toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'}) : '';
  return '<div class="event'+(event.done?' done':'')+'"><input type="checkbox" aria-label="Complete '+escape(event.title)+'" data-event="'+event.id+'" '+(event.done?'checked':'')+'><div><strong>'+escape(event.title)+'</strong><div class="sub">'+[event.type,person?.name,readable(event.date),time,event.status].filter(Boolean).map(escape).join(' · ')+' '+(overdue?'<span class="overdue">Overdue</span>':'')+'</div>'+(event.notes?'<p>'+escape(event.notes)+'</p>':'')+'<div class="row-action">'+button('Edit','editEvent',event.id)+(person?button('Schedule next','next',person.id):'')+'</div></div></div>';
}
function checklist(key) {
  const index = (asDate(key).getDay()+6)%7;
  return '<div class="grid">'+current().corners.map(([title,daily,...weekly],i)=>{
    const custom = db().corners[i] || {};
    const weekday = index < 5;
    const dailyTask = custom.daily ?? daily;
    const weeklyTask = custom.weekly?.[index] ?? weekly[index];
    const tasks = [...(weekday && dailyTask?[[0,dailyTask]]:[]),...(weeklyTask?[[1,weeklyTask]]:[])];
    return '<section class="card"><h3>'+escape(custom.title || title)+'</h3>'+tasks.map(([j,task])=>{
      const id = key+'-'+i+'-'+j;
      return '<label class="check"><input type="checkbox" data-check="'+id+'" '+(db().checks[id]?'checked':'')+'><span>'+escape(task)+'</span></label>';
    }).join('')+'</section>';
  }).join('')+'</div>';
}
function render() {
  $('workspaces').innerHTML = nav(['LWA','OYO'],'business',business);
  $('eyebrow').textContent = readable(dateKey());
  $('title').textContent = current().title;
  $('intro').textContent = current().intro;
  $('heroActions').innerHTML = button('Add to schedule','newEvent','','primary')+button('Import screenshot','import','','quiet')+button('Add person','newPerson','','quiet');
  $('tabs').innerHTML = nav(['Today','Week','Calendar','Leads',...(business==='LWA'?['Growth Partners']:[]),'People'],'tab',tab);
  const events = sortedEvents();
  if (tab==='Calendar') {
    renderCalendar(events);
    return;
  }
  if (['People','Leads','Growth Partners'].includes(tab)) {
    const growth=tab==='Growth Partners', leads=tab==='Leads';
    const people = db().people.filter(p=>growth?memberRole(p.role):leads?leadRole(p.role):true).sort((a,b)=>a.name.localeCompare(b.name));
    const headings = growth?'<h2>Growth Partners</h2><p>Check in with current LWA members on what they’re working on, where they’re stuck, and their next step.</p>'+renderMemberSchedule(people,events):leads?'<h2>Lead pipeline</h2>':'';
    const buttons = growth?button('Add member','newMember','','primary')+button('Import roster screenshot','import')+button('Set member check-in schedule','memberSchedule'):leads?button('Add lead','newLead','','primary')+button('Import lead screenshot','import'):'';
    const tracked = people.filter(p=>(!directionFilter||(p.direction||'Unclassified')===directionFilter)&&(!sourceFilter||p.source===sourceFilter));
    const metrics = leads?renderLeadMetrics(tracked):'';
    const filters = leads?'<select id="directionFilter" aria-label="Lead direction"><option value="">All directions</option>'+options(directions,directionFilter)+'</select><select id="sourceFilter" aria-label="Lead source"><option value="">All sources</option>'+options(sources,sourceFilter)+'</select>':'';

    const visible = (leads?tracked:people).filter(p=>(tab!=='People'||!roleFilter||p.role===roleFilter)&&(growth||!stageFilter||(p.stage||'New')===stageFilter)&&[p.name,p.referral,p.notes,p.social,p.email].join(' ').toLowerCase().includes(query.toLowerCase()));
    $('view').innerHTML = headings+'<div class="controls">'+buttons+'</div><div class="controls"><input id="search" type="search" aria-label="Search people" placeholder="Find a name, handle or setter" value="'+escape(query)+'">'+(tab==='People'?'<select id="roleFilter" aria-label="Filter relationship"><option value="">All relationships</option>'+options(current().roles,roleFilter)+'</select>':'')+(growth?'':'<select id="stageFilter" aria-label="Filter lead stage"><option value="">All lead stages</option>'+options(stages,stageFilter)+'</select>')+filters+'</div>'+metrics+'<div id="peopleList">'+(visible.map(p=>{
      const next = events.find(e=>e.person===p.id&&!e.done);
      const last = events.filter(e=>e.person===p.id&&e.done).at(-1);
      const logs = [...(p.conversations || [])].sort((a,b)=>b.date.localeCompare(a.date));
      const checkIn = events.find(e=>e.person===p.id&&e.memberCheckIn&&!e.done);
      const summary = [p.role,memberRole(p.role)?cadenceLabel(p.cadence):p.stage||'New',p.direction,p.source,p.referral?'Referred by '+p.referral:''].filter(Boolean).join(' · ');
      return '<section class="card"><h3>'+escape(p.name)+'</h3><div class="sub">'+escape(summary)+'</div>'+(memberRole(p.role)&&validContactDate(p.lastContact)?'<p>Last contact: '+escape(p.lastContact)+'</p>':'')+socialMarkup(p)+(p.email?'<p>'+escape(p.email)+'</p>':'')+'<p>'+escape(next?'Next: '+next.title+' · '+readable(next.date):'No next action scheduled')+(last?'<br>'+escape('Last completed: '+last.title+' · '+readable(last.date)):'')+(checkIn?'<br>'+escape('Member check-in: '+readable(checkIn.date)):'')+'</p>'+(p.notes?'<p>'+escape(p.notes)+'</p>':'')+'<div class="row-action">'+button('Log conversation','log',p.id,'primary')+button('Schedule','next',p.id)+button('Edit person','editPerson',p.id)+'</div>'+(logs.length?'<details><summary>Conversation history ('+logs.length+')</summary>'+logs.map(log=>'<div class="event"><div><strong>'+escape(readable(log.date)+' · '+log.channel)+'</strong><p>'+escape(log.notes)+'</p></div></div>').join('')+'</details>':'')+'</section>';
    }).join('')||'<p class="card">No matching people. Add a person or import a screenshot to start.</p>')+'</div>';
    return;
  }
  if (tab==='Today') {
    const today = dateKey();
    const due = events.filter(e=>!e.done&&e.date<=today);
    const complete = events.filter(e=>e.done&&e.date===today);
    $('view').innerHTML = '<h2>Top 3 next actions</h2><section class="card">'+(due.slice(0,3).map(eventRow).join('')||'<p>No open actions due today.</p>')+'</section>'+
      (due.length>3?'<h2>More due</h2><section class="card">'+due.slice(3).map(eventRow).join('')+'</section>':'')+
      '<h2>Four corners</h2>'+checklist(today)+
      (complete.length?'<h2>Completed today</h2><section class="card">'+complete.map(eventRow).join('')+'</section>':'');
    return;
  }
  const start = weekStart(day);
  const end = addDays(start,6);
  $('view').innerHTML = '<div class="controls">'+button('Previous week','week',-7)+button('This week','week',0)+button('Next week','week',7)+button('Edit four corners','corners')+'</div><h2>'+readable(start)+' – '+readable(end)+'</h2><div class="controls">'+Array.from({length:7},(_,i)=>{
    const key=addDays(start,i);
    return '<button data-action="day" data-arg="'+key+'" aria-pressed="'+(day===key)+'">'+readable(key)+'</button>';
  }).join('')+'</div><h2>'+readable(day)+'</h2><section class="card">'+(events.filter(e=>e.date===day).map(eventRow).join('')||'<p>No appointments or follow-ups scheduled.</p>')+button('Add action for this day','newEvent',day,'primary')+'</section>'+checklist(day);
}
function renderLeadMetrics(people) {
  const inbound=people.filter(p=>p.direction==='Inbound').length;
  const outbound=people.filter(p=>p.direction==='Outbound').length;
  const sales=people.filter(p=>p.stage==='Won').length;
  const conversion=people.length?(sales/people.length*100).toFixed(1)+'%':'—';
  return '<p class="sub">Totals for the selected source and direction. Conversion is the share of those leads marked Won.</p><div class="metrics">'+[['Leads',people.length],['Inbound',inbound],['Outbound',outbound],['Sales won',sales],['Lead conversion',conversion]].map(([label,value])=>'<div class="card"><strong>'+value+'</strong><span>'+label+'</span></div>').join('')+'</div>';
}
function renderMemberSchedule(people,events) {
  const today=dateKey();
  const pending=events.filter(e=>!e.done&&e.memberCheckIn&&e.date<=addDays(today,7));
  const unscheduled=people.filter(p=>!events.some(e=>e.person===p.id&&e.memberCheckIn&&!e.done)).length;
  return '<section class="card"><h3>Check-ins due through '+escape(readable(addDays(today,7)))+'</h3><p class="sub">'+unscheduled+' member'+(unscheduled===1?'':'s')+' without a scheduled check-in.</p>'+(pending.map(eventRow).join('')||'<p>No check-ins due in this window.</p>')+'</section>';
}

function shiftMonth(key, amount) {
  const date=asDate(key);
  date.setDate(1);
  date.setMonth(date.getMonth()+amount);
  return dateKey(date);
}

function renderCalendar(events) {
  const start=shiftMonth(day,0), end=shiftMonth(day,1);
  const count=asDate(addDays(end,-1)).getDate();
  const offset=(asDate(start).getDay()+6)%7;
  const label=asDate(start).toLocaleDateString('en-CA',{month:'long',year:'numeric'});
  const monthly=events.filter(e=>e.date>=start&&e.date<end);
  const counts = new Map();
  for (const event of monthly) {
    if (!event.done) counts.set(event.date,(counts.get(event.date)||0)+1);
  }
  $('view').innerHTML='<div class="controls">'+button('Previous month','month',-1)+button('This month','month',0)+button('Next month','month',1)+'</div><h2>'+escape(label)+'</h2><section class="card calendar" aria-label="'+escape(label)+'">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(text=>'<span class="weekday">'+text+'</span>').join('')+'<span aria-hidden="true"></span>'.repeat(offset)+Array.from({length:count},(_,i)=>{
    const key=addDays(start,i), open=counts.get(key)||0;
    return '<button data-action="day" data-arg="'+key+'" aria-pressed="'+(key===day)+'" aria-label="'+escape(readable(key)+', '+open+' open actions')+'" '+(key===dateKey()?'aria-current="date"':'')+'>'+String(i+1)+(open?'<small>'+open+' due</small>':'')+'</button>';
  }).join('')+'</section><h2>'+escape(readable(day))+'</h2><section class="card">'+(monthly.filter(e=>e.date===day).map(eventRow).join('')||'<p>No appointments or follow-ups scheduled.</p>')+button('Add action for this day','newEvent',day,'primary')+'</section>';
}

function modal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  if (!$('modal').open) $('modal').showModal();
}
function onSubmit(handler) {
  $('modalBody').querySelector('form').onsubmit = event => {
    event.preventDefault();
    handler(Object.fromEntries(new FormData(event.currentTarget)));
  };
}
function close() { $('modal').close(); }
function formEvent(record = {}, suggested = dateKey()) {
  modal(record.id?'Edit action':'Add to schedule','<form><label>Action<input name="title" required maxlength="150" value="'+escape(record.title)+'" placeholder="Confirm sales call"></label><div class="form-grid"><label>Type<select name="type">'+options(current().types,record.type)+'</select></label><label>Person<select name="person"><option value="">No linked person</option>'+db().people.map(p=>'<option value="'+p.id+'" '+(p.id===record.person?'selected':'')+'>'+escape(p.name)+'</option>').join('')+'</select></label><label>Date<input type="date" name="date" required value="'+(record.date||suggested)+'"></label><label>Time<input type="time" name="time" value="'+escape(record.time)+'"></label></div><label>Status<select name="status">'+options(['Planned','Booked','Confirmed','Waiting on reply','No-show','Reschedule','Completed','Closed won','Closed lost'],record.status)+'</select></label><label>Notes or meeting link<textarea name="notes" rows="3">'+escape(record.notes)+'</textarea></label><div class="actions"><button class="primary">Save action</button>'+(record.id&&!record.memberCheckIn?button('Delete action','deleteEvent',record.id):'')+'</div></form>');
  onSubmit(fields=>{
    const title=fields.title.trim();
    if (!title) return;
    const done = ['Completed','Closed won','Closed lost'].includes(fields.status);
    const event={...fields,title,id:record.id||crypto.randomUUID(),done,memberCheckIn:!!record.memberCheckIn};
    if (record.memberCheckIn) {
      event.person=record.person;
      event.type='Member check-in';
    }
    if (record.memberCheckIn && record.done && !event.done && db().events.some(e=>e.person===event.person&&e.memberCheckIn&&!e.done)) {
      close();
      notify('A newer check-in is already scheduled. Edit that check-in to move it.');
      return;
    }
    if(record.id) db().events = db().events.map(old=>old.id===record.id?event:old);
    else db().events.push(event);
    finishMemberCheckIn(record,event);
    const contact=db().people.find(person=>person.id===event.person);
    if (contact&&leadRole(contact.role)&&event.status==='Closed won') contact.stage='Won';
    close(); save('Action saved.');
  });
}
function formPerson(record={}) {
  const pending = db().events.find(e=>e.person===record.id&&e.memberCheckIn&&!e.done);
  const memberFields = business==='LWA'?'<div class="form-grid" id="memberFields"><label>Check-in frequency<select name="cadence" id="personCadence">'+cadenceOptions.map(([value,label])=>'<option value="'+value+'" '+(Number(value)===Number(record.cadence||0)?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>Next or first check-in<input type="date" name="firstDate" value="'+(pending?.date||'')+'"></label></div>':'';
  modal(record.id?'Edit person':'Add a person','<form><label>Name<input name="name" required maxlength="100" value="'+escape(record.name)+'"></label><label>Relationship<select name="role" id="personRole">'+options(current().roles,record.role||'Prospect')+'</select></label><label id="leadStage">Lead stage<select name="stage">'+options(stages,record.stage)+'</select></label>'+memberFields+'<div class="form-grid" id="leadFields"><label>Direction<select name="direction">'+options(directions,record.direction)+'</select></label><label>Source<select name="source"><option value="">Choose source</option>'+options(sources,record.source)+'</select></label></div><label>Social URLs or handles<input name="social" value="'+escape(record.social)+'" placeholder="@handle or profile URL (use | between entries)"></label><label>Email<input name="email" value="'+escape(record.email)+'"></label><label>Referred by / setter<input name="referral" maxlength="100" value="'+escape(record.referral)+'"></label><label>Notes<textarea name="notes" rows="4">'+escape(record.notes)+'</textarea></label><button class="primary">Save person</button></form>');
  const role = $('personRole');
  function updatePersonFields() {
    const member = memberRole(role.value);
    $('leadStage').hidden=member;
    $('leadFields').hidden=member;
    if ($('memberFields')) $('memberFields').hidden=!member;
  }
  role.onchange=updatePersonFields;
  updatePersonFields();
  onSubmit(fields=>{
    const name=fields.name.trim();
    if(!name) return;
    const person={...record,...fields,name,id:record.id||crypto.randomUUID(),cadence:memberRole(fields.role)?Number(fields.cadence||0):0};
    if(record.id) db().people=db().people.map(old=>old.id===record.id?person:old);
    else db().people.push(person);
    if (memberRole(person.role)) { person.direction=''; person.source=''; }
    const pending = db().events.find(e=>e.person===person.id&&e.memberCheckIn&&!e.done);
    if (person.cadence || pending) memberPlan(person,fields.firstDate || pending?.date || memberSlot(dateKey()));
    close(); save('Person saved.');
  });
}
function logConversation(person) {
  modal('Log conversation with '+person.name,'<form><div class="form-grid"><label>Date<input type="date" name="date" required value="'+dateKey()+'"></label><label>Channel<select name="channel">'+options(['Messenger / DM','Text','Phone','Video call','Email','In person','Other'])+'</select></label></div><label>Conversation notes<textarea name="notes" rows="4" required placeholder="What did you discuss? What did you agree to?"></textarea></label>'+(memberRole(person.role)?'':'<label>Lead stage<select name="stage">'+options(stages,person.stage||'New')+'</select></label>')+'<label>Next follow-up date<input type="date" name="followDate"></label><label>Follow-up action<input name="followTitle" maxlength="150" placeholder="Send replay or confirm the call"></label><button class="primary">Save conversation</button></form>');
  onSubmit(fields=>{
    const notes=fields.notes.trim();
    if(!notes)return;
    person.conversations ||= [];
    person.conversations.push({date:fields.date,channel:fields.channel,notes});
    if(memberRole(person.role)&&validContactDate(fields.date)&&fields.date>(person.lastContact||'')) person.lastContact=fields.date;
    if(fields.stage) person.stage=fields.stage;
    if(fields.followDate) db().events.push({id:crypto.randomUUID(),person:person.id,title:fields.followTitle.trim()||'Follow up with '+person.name,type:'Follow-up',date:fields.followDate,time:'',status:'Planned',notes:'',done:false});
    close();
    save(fields.followDate?'Conversation logged and follow-up scheduled.':'Conversation logged.');
  });
}

function scheduleMembers() {
  const available = db().people.filter(person=>memberRole(person.role)&&!db().events.some(event=>event.memberCheckIn&&event.person===person.id&&!event.done));
  if (!available.length) {
    modal('Member check-in schedule','<p>All saved members already have a schedule, or there are no members yet. Add members under People or import their names from a screenshot. Edit any member to set an individual schedule.</p>');
    return;
  }
  modal('Member check-in schedule','<p>Start a recurring plan for '+available.length+' member'+(available.length===1?'':'s')+' without a schedule. Each completed check-in schedules the next one.</p><form><label>Frequency<select name="cadence">'+cadenceOptions.slice(1).map(([value,label])=>'<option value="'+value+'" '+(value==='14'?'selected':'')+'>'+label+'</option>').join('')+'</select></label><div class="form-grid"><label>Start date<input type="date" name="date" required value="'+dateKey()+'"></label><label>Check-ins per week<input name="batch" type="number" value="'+weeklyCap()+'" min="5" max="10" required></label></div><button class="primary">Schedule member check-ins</button></form>');
  onSubmit(fields=>{
    db().memberWeeklyCap=Number(fields.batch);
    queueMembers(available,Number(fields.cadence),fields.date);
    day=nextWeekday(fields.date);
    tab='Calendar';
    close();
    save(available.length+' member check-in schedules started.');
  });
}

function screenshotContacts(blocks, text, member=false) {
  const emailPattern=/[\w.%+\-]+@[\w.\-]+\.[a-z]{2,}/gi;
  const linkPattern=/https?:\/\/[^\s|]+|(?:www\.)?(?:facebook|instagram|tiktok|linkedin|threads|youtube)\.com\/[^\s|]+|(?<![\w.])@[\w.\-]+/gi;
  const words=(blocks||[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.flatMap(line=>line.words)));
  const rows=[];
  for(const word of words.sort((a,b)=>a.bbox.y0-b.bbox.y0)){
    const y=(word.bbox.y0+word.bbox.y1)/2;
    const row=rows.find(row=>Math.abs(row.y-y)<Math.max(5,(word.bbox.y1-word.bbox.y0)*.48));
    if(row) row.words.push(word);
    else rows.push({y,words:[word]});
  }
  const nameLike=/^[\p{L}\p{M}.'’\-]+(?:\s+[\p{L}\p{M}.'’\-]+){1,5}$/u;
  const cleanLink=value=>value.replace(/\?$/,'').replace(/[.,);]+$/,'');
  const lines=rows.map(row=>({...row,words:row.words.sort((a,b)=>a.bbox.x0-b.bbox.x0)}));
  const anchors=lines.flatMap(row=>{
    const status=row.words.find(word=>/^(conversation|follow[-–]?up|new|booked|won|closed|active|member|check[-–]?in|onboarding)$/i.test(word.text));
    if(!status)return [];
    const left=row.words.filter(word=>word.bbox.x1<status.bbox.x0);
    const name=left.map(word=>word.text).join(' ');
    return nameLike.test(name)&&status.bbox.x0-left.at(-1).bbox.x1>15?[{...row,name,divider:status.bbox.x0}]:[];
  });
  if(member && !anchors.length){
    const leftEdge=Math.min(...words.map(word=>word.bbox.x0));
    const titleName=/^\p{Lu}[\p{L}\p{M}.'’\-]*(?:\s+\p{Lu}[\p{L}\p{M}.'’\-]*){1,5}$/u;
    const heading=/\b(growth partner|last contact|last spoke|last check|notes|email|profile|social|follow.up|member|name|facebook|send message|date)\b/i;
    for(const row of lines){
      const first=row.words[0];
      if(first.bbox.x0>leftEdge+25)continue;
      const columns=[[]];
      for(const word of row.words){
        const previous=columns.at(-1).at(-1);
        if(previous&&word.bbox.x0-previous.bbox.x1>Math.max(25,(first.bbox.y1-first.bbox.y0)*1.7))columns.push([]);
        columns.at(-1).push(word);
      }
      const label=columns[0].map(word=>word.text).join(' ');
      const name=label.replace(/^name\s*:\s*/i,'').trim();
      if(titleName.test(name)&&!heading.test(name))anchors.push({...row,name,divider:columns.length>1?columns[1][0].bbox.x0:Infinity});
    }
  }
  if(anchors.length){
    return anchors.map((contact,i)=>{
      const group=lines.filter(row=>row.y>=contact.y-4&&row.y<(anchors[i+1]?.y??Infinity)-4);
      const notes=group.filter(row=>row.y>contact.y+4).map(row=>row.words.filter(word=>word.bbox.x0<contact.divider).map(word=>word.text).join(' ').replace(emailPattern,'').replace(linkPattern,'').trim()).filter(Boolean).join(' ');
      const contents=group.map(row=>row.words.map(word=>word.text).join(' ')).join('\n');
      const explicitDate=member?contents.match(/(?:last contact(?:ed)?|last spoke|last check[- ]?in)\s*[:–-]?\s*([^\n]+)/i)?.[1]:'';
      return {name:contact.name,notes,...(explicitDate?{lastContact:lastContactFromNotes(explicitDate)}:{}),social:(contents.replace(emailPattern,'').match(linkPattern)||[]).map(cleanLink).join(' | '),email:(contents.match(emailPattern)||[]).join(', ')};
    });
  }
  const contacts=[];
  for(const line of text.split('\n')){
    const email=(line.match(emailPattern)||[]).join(', ');
    const cleaned=line.replace(emailPattern,'');
    const social=(cleaned.match(linkPattern)||[]).map(cleanLink).join(' | ');
    const name=cleaned.replace(linkPattern,'').replace(/^[•|\s]+|[|:\s]+$/g,'');
    if(nameLike.test(name)&&!/\b(message|notes|email|profile|search|request|reply|send|just|conversation|member|people|follow|invite)\b/i.test(name)) contacts.push({name,notes:'',social,email});
  }
  return contacts;
}

function reviewContacts(contacts, member) {
  $('contactReview').innerHTML=contacts.map(contact=>'<fieldset class="import-contact"><legend>Contact</legend><label>Name<input name="contactName" value="'+escape(contact.name)+'"></label><label>Notes<textarea name="contactNotes" rows="3">'+escape(contact.notes)+'</textarea></label><label>Social link or handle<input name="contactSocial" value="'+escape(contact.social)+'"></label><label>Email<input name="contactEmail" value="'+escape(contact.email)+'"></label>'+(member?'<label>Last contact date<input type="date" name="contactLastContact" max="'+dateKey()+'" value="'+escape(contact.lastContact??lastContactFromNotes(contact.notes||''))+'"></label>':'')+'<button type="button" class="remove-contact">Remove</button></fieldset>').join('');
}

function importScreenshot() {
  const growth=tab==='Growth Partners';
  const roles=growth?current().roles.filter(memberRole):tab==='Leads'?current().roles.filter(leadRole):current().roles;
  modal(growth?'Import member roster':'Import screenshot','<form><p>Choose a screenshot from Photos or Files. Review each contact’s name, notes, links and email before saving.</p>'+(growth?'<p>Check the suggested last-contact dates. The oldest contacts go first, and the weekly limit also applies to recurring check-ins.</p>':'')+'<label>Screenshot<input type="file" id="image" accept="image/*"></label><button type="button" id="scan">Read screenshot</button><p id="scanStatus" role="status"></p><details><summary>See extracted text</summary><textarea id="raw" aria-label="Extracted text" readonly rows="5"></textarea></details><label>Contact import file (optional)<input type="file" id="contactFile" accept=".json,application/json"></label><div id="contactReview"></div><button type="button" id="addImportContact">Add contact to review</button><label>Relationship<select name="role" id="importRole">'+options(roles,growth?'Growth Partner member':'Prospect')+'</select></label><div class="form-grid" id="importLeadFields"><label>Direction<select name="direction">'+options(directions)+'</select></label><label>Source<select name="source">'+options(sources,'Own lead')+'</select></label></div><label>After import<select name="plan" id="importPlan"></select></label><div class="form-grid" id="importDates"><label>Start date<input type="date" name="date" required value="'+dateKey()+'"></label><label>'+(growth?'Check-ins per week':'People per weekday')+'<input type="number" name="batch" value="'+(growth?weeklyCap():5)+'" min="'+(growth?5:1)+'" max="'+(growth?10:100)+'" required></label></div><button id="importSave" class="primary">Save contacts</button></form>');
  const status=$('scanStatus'), scan=$('scan'), submit=$('importSave'), fileInput=$('image'), raw=$('raw');
  const role=$('importRole'), plan=$('importPlan');
  const review=$('contactReview');
  const readReview=()=>[...review.querySelectorAll('fieldset')].map(row=>Object.fromEntries(['Name','Notes','Social','Email',...(growth?['LastContact']:[])].map(key=>[key[0].toLowerCase()+key.slice(1),row.querySelector('[name=contact'+key+']').value.trim()])));
  review.onclick=event=>{if(event.target.matches('.remove-contact'))event.target.closest('fieldset').remove();};
  $('addImportContact').onclick=()=>reviewContacts([...readReview(),{}],growth);
  $('contactFile').onchange=async event=>{
    try{
      const contacts=JSON.parse(await event.target.files[0].text());
      if(!Array.isArray(contacts)||!contacts.length||!contacts.every(contact=>contact&&typeof contact.name==='string'&&['notes','social','email','lastContact'].every(key=>contact[key]===undefined||typeof contact[key]==='string')))throw Error('Invalid contacts');
      reviewContacts([...readReview(),...contacts],growth);
      status.textContent='Review the contacts before saving.';
    }catch{status.textContent='Choose a contact import JSON file.';}
  };

  role.onchange=()=>{
    const member=memberRole(role.value);
    $('importLeadFields').hidden=member;
    plan.innerHTML='<option value="0">Save contacts only</option>'+(member?cadenceOptions.slice(1).map(([value,label])=>'<option value="'+value+'">'+label+' member check-ins</option>').join(''):'<option value="reach">Schedule first reach-outs</option>');
    plan.value=growth?'14':'0';
    plan.onchange();
  };
  plan.onchange=()=>{$('importDates').hidden=plan.value==='0';};
  role.onchange();
  scan.onclick = async () => {
    const file=fileInput.files[0];
    if(!file){status.textContent='Choose a screenshot first.';return;}
    scan.disabled=true;
    submit.disabled=true;
    status.textContent='Loading the screenshot reader…';
    let worker;
    try {
      const assets=new URL('ocr/',location.href);
      worker=await Tesseract.createWorker('eng',1,{
        workerPath:new URL('worker.min.js',assets).href,
        corePath:new URL('tesseract-core-lstm.wasm.js',assets).href,
        langPath:assets.href.replace(/\/$/,''),
        logger:message=>{if(message.status==='recognizing text') status.textContent='Reading screenshot… '+Math.round(message.progress*100)+'%';}
      });
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      const result=await worker.recognize(file,{}, {text:true,blocks:true});
      raw.value=result.data.text;
      const candidates=screenshotContacts(result.data.blocks,raw.value,growth);
      reviewContacts([...readReview(),...candidates],growth);
      status.textContent=candidates.length?'Review the fields under each name before saving.':'No contact names were identified in this image. Try a closer crop with the names and their notes visible.';
    } catch { status.textContent='The screenshot could not be read. Try a PNG or JPEG, or add a contact manually.'; }
    finally { if(worker) await worker.terminate().catch(()=>{});scan.disabled=false;submit.disabled=false; }
  };
  onSubmit(fields=>{
    const rows=readReview().map(contact=>({...contact,links:contact.social.split(/\s*\|\s*/).filter(Boolean)}));
    if(!rows.length||rows.some(row=>!row.name)){
      status.textContent='Add a name at the start of each line or remove that line.';
      return;
    }
    const isMember=memberRole(fields.role);
    const touched=new Set();
    const memberQueue=[];
    let planned=nextWeekday(fields.date), scheduled=0;
    for(const {name,links,notes,email,lastContact} of rows) {
      const candidates=db().people.filter(p=>memberRole(p.role)===isMember&&p.name.toLowerCase()===name.toLowerCase());
      const sameProfile=candidates.find(p=>p.social?.split(/\s*\|\s*/).some(value=>links.some(link=>link.toLowerCase()===value.toLowerCase())));
      let person=sameProfile;
      if(!person&&candidates.length===1&&(!links.length||!candidates[0].social||candidates[0].social.split(' | ').some(old=>links.some(link=>old.split('?')[0]===link.split('?')[0])))) person=candidates[0];
      if(!person){
        person={id:crypto.randomUUID(),name,role:fields.role,referral:'',notes:'',stage:'New',source:isMember?'':fields.source,direction:isMember?'':fields.direction};
        db().people.push(person);
      }
      if(notes && !(person.notes||'').includes(notes)) person.notes=[person.notes,notes].filter(Boolean).join('\n\n');
      if(email && !(person.email||'').includes(email)) person.email=[person.email,email].filter(Boolean).join(', ');
      if(links.length) person.social=[...new Set([...(person.social||'').split(/\s*\|\s*/).filter(Boolean),...links])].join(' | ');
      if(!isMember) {
        if(!person.source) person.source=fields.source;
        if(!person.direction||person.direction==='Unclassified') person.direction=fields.direction;
      }
      if(isMember&&validContactDate(lastContact)&&lastContact>(person.lastContact||'')) person.lastContact=lastContact;
      if(touched.has(person.id))continue;
      touched.add(person.id);
      if(fields.plan==='0')continue;
      if(growth){memberQueue.push(person);continue;}
      if(isMember&&person.cadence)continue;
      if(fields.plan==='reach'&&db().events.some(e=>e.person===person.id&&!e.done&&e.type==='Reach-out'))continue;
      if(scheduled&&scheduled%Number(fields.batch)===0) planned=nextWeekday(addDays(planned,1));
      if(isMember){
        person.cadence=Number(fields.plan);
        memberPlan(person,memberSlot(planned));
      }else{
        db().events.push({id:crypto.randomUUID(),title:'Reach out to '+person.name,person:person.id,type:'Reach-out',date:planned,time:'',status:'Planned',notes:'',done:false});
      }
      scheduled++;
    }
    if(growth&&fields.plan!=='0'){
      db().memberWeeklyCap=Number(fields.batch);
      scheduled=queueMembers(memberQueue,Number(fields.plan),fields.date);
    }
    day=nextWeekday(fields.date);
    tab=isMember?'Growth Partners':leadRole(fields.role)?'Leads':'People';
    query='';roleFilter='';stageFilter='';directionFilter='';sourceFilter='';
    close();
    save(touched.size+' contact'+(touched.size===1?'':'s')+' saved.'+(scheduled?' '+scheduled+' first follow-up'+(scheduled===1?'':'s')+' scheduled.':''));
  });
}
function editCorners() {
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  modal('Edit four corners','<form>'+current().corners.map(([title,daily,...weekly],i)=>{
    const custom=db().corners[i]||{};
    const input=(label,key,val)=>'<label>'+label+'<input name="'+key+'" value="'+escape(val)+'"></label>';
    return '<fieldset><legend>Corner '+(i+1)+'</legend>'+input('Name','title'+i,custom.title||title)+input('Every weekday','daily'+i,custom.daily??daily)+days.map((d,j)=>input(d,i+'-'+j,custom.weekly?.[j]??weekly[j])).join('')+'</fieldset>';
  }).join('')+'<p>Leave a task empty to skip it.</p><button class="primary">Save routine</button></form>');
  onSubmit(fields=>{
    current().corners.forEach((_,i)=>db().corners[i]={title:fields['title'+i].trim(),daily:fields['daily'+i].trim(),weekly:days.map((_,j)=>fields[i+'-'+j].trim())});
    close();save('Routine saved.');
  });
}
function backups() {
  modal('Backups','<p>Records live in this browser. Export both workspaces to back them up or move them to another device. Restoring replaces both workspaces on this device.</p>'+button('Export backup','download','','primary')+'<label class="field">Choose a backup to restore<input type="file" id="restore" accept=".json,application/json"></label>');
  $('restore').onchange=async event=>{
    try {
      const restored=JSON.parse(await event.target.files[0].text());
      const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(asDate(value));
      const validId=value=>typeof value==='string'&&/^[a-f\d-]{36}$/i.test(value);
      const valid=['LWA','OYO'].every(key=>{
        const w=restored[key];
        return w&&Array.isArray(w.events)&&Array.isArray(w.people)&&w.checks&&w.corners&&
          w.events.every(e=>e&&validId(e.id)&&validDate(e.date)&&typeof e.title==='string'&&(!e.time||/^\d{2}:\d{2}$/.test(e.time)))&&
          w.people.every(p=>p&&validId(p.id)&&typeof p.name==='string'&&
            (p.conversations===undefined||Array.isArray(p.conversations)&&p.conversations.every(log=>log&&validDate(log.date)&&typeof log.channel==='string'&&typeof log.notes==='string')));
      });
      if(!valid) throw Error('Invalid backup');
      if(confirm('Replace both workspaces on this device with the selected backup?')){data=restored;close();save('Backup restored.');}
    } catch {notify('Choose a valid Growth Command Center backup.');}
  };
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');
  if(!target)return;
  const {action,arg}=target.dataset;
  switch(action) {
    case 'business': business=arg;if(tab==='Growth Partners')tab='Today';query='';roleFilter='';stageFilter='';directionFilter='';sourceFilter='';render();break;
    case 'tab': tab=arg;query='';roleFilter='';stageFilter='';render();break;
    case 'day': day=arg;render();break;
    case 'month': day=+arg?shiftMonth(day,+arg):dateKey();render();break;
    case 'log': logConversation(db().people.find(p=>p.id===arg));break;
    case 'memberSchedule': scheduleMembers();break;
    case 'week': day=+arg?addDays(day,+arg):dateKey();render();break;
    case 'corners': editCorners();break;
    case 'import': importScreenshot();break;
    case 'newPerson': formPerson();break;
    case 'newLead': formPerson({role:'Prospect',source:'Own lead'});break;
    case 'newMember': formPerson({role:'Growth Partner member',cadence:14});break;
    case 'editPerson': formPerson(db().people.find(p=>p.id===arg));break;
    case 'newEvent': formEvent({},arg||dateKey());break;
    case 'next': formEvent({person:arg,type:'Follow-up',title:'Follow up with '+db().people.find(p=>p.id===arg).name});break;
    case 'editEvent': formEvent(db().events.find(e=>e.id===arg));break;
    case 'deleteEvent':
      if(confirm('Delete this scheduled action?')){db().events=db().events.filter(e=>e.id!==arg);close();save('Action deleted.');}
      break;
    case 'download': {
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=url;link.download='growth-command-backup-'+dateKey()+'.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      break;
    }
  }
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.dataset.check){
    if(target.checked) db().checks[target.dataset.check]=true;
    else delete db().checks[target.dataset.check];
    save();
  }
  if(target.dataset.event){
    const item=db().events.find(record=>record.id===target.dataset.event);
    if (item.memberCheckIn && !target.checked && db().events.some(e=>e.person===item.person&&e.memberCheckIn&&!e.done)) {
      render();
      notify('A newer check-in is already scheduled. Edit that check-in to move it.');
      return;
    }
    const previous={...item};
    item.done=target.checked;
    item.status=item.done?'Completed':'Planned';
    finishMemberCheckIn(previous,item);
    save(item.done&&item.memberCheckIn?'Check-in completed. The next one is scheduled.':'');
  }
  if(target.id==='roleFilter'){roleFilter=target.value;render();}
  if(target.id==='stageFilter'){stageFilter=target.value;render();}
  if(target.id==='directionFilter'){directionFilter=target.value;render();}
  if(target.id==='sourceFilter'){sourceFilter=target.value;render();}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){
    query=event.target.value;
    const cursor=event.target.selectionStart;
    render();
    $('search').focus();$('search').setSelectionRange(cursor,cursor);
  }
});
$('close').onclick=close;
$('backup').onclick=backups;
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
