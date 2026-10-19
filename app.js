(() => {
  const STORAGE_KEY = "notezy-public-notes-v1";
  const LIKE_KEY = "notezy-liked-notes-v1";
  const HIDDEN_KEY = "notezy-hidden-notes-v1";
  const CLIENT_KEY = "notezy-client-id-v1";
  const AUTHOR_KEY = "notezy-display-name-v1";
  const LOCAL_CLEAR_KEY = "notezy-local-notes-cleared-v1";
  if (location.protocol === "file:" && localStorage.getItem(LOCAL_CLEAR_KEY) !== "done") {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(LOCAL_CLEAR_KEY, "done");
  }
  const tones = ["tone-navy", "tone-deep", "tone-royal", "tone-sky", "tone-ice", "tone-white"];
  const $ = id => document.getElementById(id);
  const wall = $("wall"), universe = $("universe"), search = $("search"), canvas = $("particles");
  const ctx = canvas.getContext("2d", { alpha: true });
  const composer = $("composer-dialog"), detail = $("detail-dialog"), toast = $("toast");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let notes = read(STORAGE_KEY, []), liked = new Set(read(LIKE_KEY, [])), hidden = new Set(read(HIDDEN_KEY, []));
  let remoteMode = false, remoteReady = false, detailOpen = false, selectedId = null, discoveryId = null, discoveryTimer = 0, activeConversationId = null;
  let currentDetail = null, toastTimer, detailCloseTimer = 0, frameId = 0, lastFrame = 0, lastCollisionAt = 0, layoutResizeTimer = 0, eventSource = null;
  const motion = new Map(), cardRegistry = new Map(), arrivalIds = new Set(), replyCache = new Map(), animatedReplyIds = new Set();
  const replyDrafts = new Map();
  let replyLoadToken = 0;
  let pendingReply = readSession("notezy-pending-reply-v1", null);
  let discoveryHistory = [];
  const pointer = { x: -1000, y: -1000, active: false };
  let particles = [], remoteLoadPromise, flowAmount = 0;

  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function readSession(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
  const anonymousIcon = '<svg class="anonymous-avatar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.8 19c.7-3.1 2.8-4.8 6.2-4.8s5.5 1.7 6.2 4.8"/></svg>';
  function authorName(note) { return note.anonymous ? "Anonymous" : note.author || "Someone"; }
  function matchesDate(note, filter) {
    if (filter === "all") return true;
    const stamp=Number(note.createdAt);if(!Number.isFinite(stamp))return false;
    const posted=new Date(stamp),now=new Date();
    if(filter==="today")return posted.getFullYear()===now.getFullYear()&&posted.getMonth()===now.getMonth()&&posted.getDate()===now.getDate();
    if(filter==="week"){const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());start.setDate(start.getDate()-((start.getDay()+6)%7));const end=new Date(start);end.setDate(end.getDate()+7);return posted>=start&&posted<end;}
    return true;
  }
  function filteredNotes() {
    const query=search.value.trim().toLocaleLowerCase(),filter=$("date-filter").value;
    return visibleNotes().filter(note=>matchesDate(note,filter)&&(!query||matches(note,query))).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
  }
  function layoutFor(count){
    const mobile=innerWidth<=520,tablet=innerWidth<=900,width=Math.max(1,wall.clientWidth),height=Math.max(1,wall.clientHeight),area=width*height;
    const baseWidth=innerWidth<=390?166:mobile?184:tablet?216:250,baseHeight=innerWidth<=390?148:mobile?160:tablet?184:210;
    const minScale=mobile ? .4 : tablet ? .34 : .3,maxScale=mobile?1:1.12,baseFootprint=(baseWidth+18)*(baseHeight+18),occupancy=count*baseFootprint/area;
    const scale=Math.max(minScale,Math.min(maxScale,Math.sqrt(.56/Math.max(.02,occupancy))));
    const countLevel=count<=5?0:count<=15?1:count<=30?2:count<=60?3:count<=100?4:5;
    const spaceLevel=scale>=.98?0:scale>=.82?1:scale>=.66?2:scale>=.5?3:scale>=.38?4:5;
    const level=Math.max(countLevel,spaceLevel),density=["few","moderate","many","packed","galaxy","miniature"][level];
    const normalized=(scale-minScale)/(maxScale-minScale),gap=level>=5?3:level===4?5:Math.round((mobile?5:7)+normalized*(mobile?10:19));
    const regularWidth=Math.max(mobile?98:112,baseWidth*scale);
    const cardWidth=level>=5?(mobile?52:tablet?56:60):level===4?Math.max(mobile?72:84,Math.min(108,regularWidth*.48)):regularWidth;
    wall.style.setProperty("--adaptive-scale",scale.toFixed(3));wall.style.setProperty("--adaptive-card-width",`${cardWidth.toFixed(1)}px`);
    const padding=level>=5?0:level===4?7:Math.max(8,17*scale);
    wall.style.setProperty("--adaptive-padding-y",`${padding.toFixed(1)}px`);wall.style.setProperty("--adaptive-padding-x",`${(level>=5?0:level===4?8:Math.max(8,18*scale)).toFixed(1)}px`);wall.style.setProperty("--adaptive-padding-bottom",`${(level>=5?0:level===4?7:Math.max(7,14*scale)).toFixed(1)}px`);wall.style.setProperty("--adaptive-gap",`${gap}px`);wall.dataset.gap=String(gap);
    return{density,scale,gap};
  }
  function spacingForDensity(){return Number(wall.dataset.gap)||6;}
  function targetFlow(){const density=wall.dataset.density;if(density==="miniature")return .18;if(density==="galaxy")return .28;if(density==="packed")return .72;if(density==="many")return .58;if(density==="moderate")return .42;return .3;}
  function timeAgo(value) {
    const diff = Math.max(0, Date.now() - Number(value)), minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24); if (days < 7) return `${days}d ago`;
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2400); }
  function setConnection(state, label) { const item = document.querySelector(".live-indicator"); item.className = `live-indicator ${state}`; $("live-label").textContent = label; }
  function visibleNotes() { return notes.filter(note => !hidden.has(note.id)); }
  function matches(note, query) { return [note.title, note.content, note.author, note.recipient, note.category, note.anonymous ? "anonymous" : ""].join(" ").toLocaleLowerCase().includes(query); }
  function sizeClass(note) { const length = (note.title || "").length + (note.content || "").length + (note.recipient || "").length; return length < 100 ? "size-small" : length > 270 ? "size-large" : "size-medium"; }
  function depthLayer(id) { const band=seed(id)%10;return band<3?"background":band<8?"middle":"foreground"; }

  function cardBody(note) {
    const author = authorName(note), avatar = note.anonymous ? anonymousIcon : escapeHtml(author.trim().charAt(0).toUpperCase() || "•");
    const title = note.title ? `<h3 class="card-title">${escapeHtml(note.title)}</h3>` : "";
    const category = note.category ? `<span class="category-tag">${escapeHtml(note.category)}</span>` : "<span></span>";
    const createdAt = Number(note.createdAt) || Date.now();
    const recipient = note.recipient ? `<span class="card-recipient">To: ${escapeHtml(note.recipient)}</span>` : "";
    return `<span class="galaxy-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2.8 14.5 9.5 21.2 12l-6.7 2.5L12 21.2l-2.5-6.7L2.8 12l6.7-2.5L12 2.8Z"/></svg></span><div class="card-top">${category}<time class="note-time" datetime="${new Date(createdAt).toISOString()}">${timeAgo(createdAt)}</time></div>${title}${recipient}<p class="card-content${title ? "" : " no-title"}">${escapeHtml(note.content)}</p>
      <div class="card-footer"><div class="author-line"><span class="author-avatar${note.anonymous ? " anonymous" : ""}">${avatar}</span><span class="author-name">${escapeHtml(author)}</span></div></div>`;
  }
  function ensureCard(note, index, query) {
    let card = cardRegistry.get(note.id), created = !card;
    const isMatch = !query || matches(note, query);
    if (!card) {
      card = document.createElement("article");
      card.dataset.id = note.id;
      card.setAttribute("role", "group");
      card.tabIndex = 0;
      cardRegistry.set(note.id, card);
      resizeObserver.observe(card);
      card.onpointerenter = () => { const item = motion.get(note.id); if (item) item.hovered = true; card.style.zIndex = "20"; };
      card.onpointerleave = () => { const item = motion.get(note.id); if (item) item.hovered = card.matches(":focus-visible"); if (!card.matches(":focus-visible")) card.style.zIndex = String(depthLayer(note.id) === "foreground" ? 6 : depthLayer(note.id) === "middle" ? 4 : 2); };
      card.onfocus = () => { const item = motion.get(note.id); if (item) item.hovered = true; card.style.zIndex = "20"; };
      card.onblur = () => { const item = motion.get(note.id); if (item) item.hovered = card.matches(":hover"); if (!card.matches(":hover")) card.style.zIndex = String(depthLayer(note.id) === "foreground" ? 6 : depthLayer(note.id) === "middle" ? 4 : 2); };
      card.addEventListener("animationend", event => {
        if (event.animationName === "note-arrive") {
          card.classList.remove("arriving");
          arrivalIds.delete(note.id);
          card.classList.add("newest");
          setTimeout(() => card.classList.remove("newest"), 5200);
        }
      });
    }
    const active = document.activeElement;
    const restoreFocus = active?.closest?.(".note-card") === card ? active.dataset.action : null;
    const stillArriving = arrivalIds.has(note.id) && (created || card.classList.contains("arriving"));
    const layer=depthLayer(note.id);
    card.className = `note-card ${sizeClass(note)} layer-${layer} ${tones[seed(note.id) % tones.length]}${stillArriving ? " arriving" : ""}${arrivalIds.has(note.id) ? " newest" : ""}${discoveryId === note.id ? " discovered" : ""}${query ? (isMatch ? " search-match" : " search-dim") : ""}${selectedId === note.id ? " selected" : ""}`;
    card.setAttribute("aria-label", `Note${note.title ? `: ${note.title}` : ""}${note.recipient ? ` for ${note.recipient}` : ""}. Press Enter to read.`);
    card.style.zIndex = String(layer === "foreground" ? 6 : layer === "middle" ? 4 : 2);
    card.innerHTML = cardBody(note);
    if (created && !card.parentElement) wall.append(card);
    if (restoreFocus) card.querySelector(`[data-action="${restoreFocus}"]`)?.focus();
    return card;
  }
  function canvasNotes(pool){
    const limit=innerWidth<=520?80:innerWidth<=900?140:220;
    if(pool.length<=limit)return pool;
    const byId=new Map(pool.map(note=>[note.id,note])),chosen=new Set();
    for(const id of [selectedId,discoveryId,pool[0]?.id,...arrivalIds])if(id&&byId.has(id)&&chosen.size<limit)chosen.add(id);
    const remaining=pool.filter(note=>!chosen.has(note.id)).map(note=>({note,rank:seed(note.id)})).sort((a,b)=>a.rank-b.rank);
    for(const item of remaining){if(chosen.size>=limit)break;chosen.add(item.note.id);}
    return pool.filter(note=>chosen.has(note.id));
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase(),pool=filteredNotes(),layout=layoutFor(pool.length),density=layout.density;
    wall.dataset.density=density;wall.classList.remove("density-few","density-moderate","density-many","density-packed","density-galaxy","density-miniature");wall.classList.add(`density-${density}`);
    const shown=canvasNotes(pool);
    const shownIds = new Set(shown.map(note => note.id));
    for (const [id, card] of cardRegistry) if (!shownIds.has(id)) { resizeObserver.unobserve(card);card.remove();cardRegistry.delete(id); }
    shown.forEach((note, index) => ensureCard(note, index, query));
    $("note-count").textContent = `${pool.length} ${pool.length === 1 ? "note" : "notes"}`;
    $("discover-button").disabled = pool.length === 0;
    const dateLabel={today:"Today",week:"This week",all:"All notes"}[$("date-filter").value];
    $("wall-caption").textContent=shown.length<pool.length?`Showing ${shown.length} of ${pool.length} · search or Surprise me to explore`:query?`${dateLabel} · ${pool.length} matching thought${pool.length===1?"":"s"}`:dateLabel==="All notes"?"drifting through the universe":`${dateLabel} · ${pool.length} ${pool.length===1?"thought":"thoughts"}`;
    $("universe-hint").hidden = pool.length === 0 || Boolean(query)||$("date-filter").value!=="all";
    const noResults = pool.length === 0, empty = $("empty-state");
    empty.hidden = remoteReady && !noResults;
    const filter = $("date-filter").value;
    const disconnected = remoteMode && !document.querySelector(".live-indicator").classList.contains("connected");
    const initialEmpty = visibleNotes().length === 0 && !query && filter === "all";
    empty.classList.toggle("search-empty", Boolean(query)||filter!=="all");
    if (!remoteReady || disconnected) {
      $("empty-title").textContent = disconnected ? "Reconnecting to the shared wall" : "Finding the floating thoughts...";
      $("empty-copy").textContent = disconnected ? "The shared wall is temporarily unavailable. Your search will update when the connection returns." : "Connecting to the shared universe.";
    } else if (initialEmpty) {
      $("empty-title").textContent = "No thoughts here yet.";
      $("empty-copy").textContent = "Be the first to share something with the universe.";
    } else if (query) {
      $("empty-title").textContent = "No thoughts found";
      $("empty-copy").textContent = "We couldn't find any notes matching your search.";
    } else if (filter === "today" || filter === "week") {
      $("empty-title").textContent = filter === "today" ? "No thoughts for today" : "No thoughts for this week";
      $("empty-copy").textContent = "Try exploring notes from another time.";
    } else {
      $("empty-title").textContent = "No thoughts here yet.";
      $("empty-copy").textContent = "Be the first to share something with the universe.";
    }
    $("empty-write").hidden = !remoteReady || disconnected || !initialEmpty;
    $("empty-clear-search").hidden = !remoteReady || disconnected || !query;
    $("empty-view-all").hidden = !remoteReady || disconnected || Boolean(query) || filter === "all";
    for (const id of motion.keys()) if (!shownIds.has(id) && id !== selectedId) motion.delete(id);
    if(detailOpen&&activeConversationId){const active=notes.find(note=>note.id===activeConversationId);if(active){currentDetail=active;updateDetailCounts(active);}}
    setupCards(); wall.setAttribute("aria-busy", String(!remoteReady));
    if(reducedMotion.matches){flowAmount=targetFlow();drawParticles(0,0);}
    startMotion();
  }

  function seed(value) { let h=2166136261; for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return h>>>0; }
  function randomizer(initial) { let state=initial||1;return()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}; }
  function createMotion(note, width, height) {
    const random=randomizer(seed(note.id)), w=width||210,h=height||175,bounds=wall.getBoundingClientRect();
    const maxX=Math.max(0,bounds.width-w),maxY=Math.max(0,bounds.height-h-62);
    const entering=arrivalIds.has(note.id),gap=spacingForDensity(),others=[...cardRegistry.keys()].filter(id=>id!==note.id).map(id=>motion.get(id)).filter(Boolean);
    let x=0,y=12,best=Infinity;
    const placementAttempts=others.length>160?6:others.length>80?12:72;
    for(let attempt=0;attempt<placementAttempts;attempt++){
      const candidateX=entering?Math.max(0,Math.min(maxX,bounds.width*.49-w/2+(random()-.5)*Math.min(260,bounds.width*.48))):random()*maxX;
      const candidateY=entering?Math.max(12,Math.min(maxY,bounds.height*.47-h/2+(random()-.5)*Math.min(210,bounds.height*.42))):12+random()*Math.max(1,maxY-12);
      let overlap=0;
      for(const other of others){const ox=(w+other.w)/2+gap-Math.abs((candidateX+w/2)-(other.x+other.w/2)),oy=(h+other.h)/2+gap-Math.abs((candidateY+h/2)-(other.y+other.h/2));if(ox>0&&oy>0)overlap+=ox*oy;}
      if(overlap<best){best=overlap;x=candidateX;y=candidateY;}if(overlap===0)break;
    }
    const layer=depthLayer(note.id),angle=random()*Math.PI*2,layerSpeed=layer==="background" ? .72 : layer==="foreground" ? 1.22 : 1,speed=14+random()*12;
    const depth=layer==="background" ? .91+random()*.035 : layer==="foreground" ? 1.025+random()*.035 : .965+random()*.055;
    const rotation=layer==="background" ? .3 : layer==="foreground" ? .72 : .52,baseVx=Math.cos(angle)*speed*layerSpeed,baseVy=Math.sin(angle)*speed*layerSpeed;
    return{x,y,vx:baseVx,vy:baseVy,baseVx,baseVy,sepX:0,sepY:0,targetSepX:0,targetSepY:0,w,h,rot:(random()-.5)*rotation,phase:random()*6.28,flowPhase:random()*6.28,flowRate:.17+random()*.2,driftRate:.2+random()*.25,driftX:6+random()*7,driftY:5+random()*7,turnRate:.18+random()*.2,depth,layer,hovered:false,interaction:1,born:arrivalIds.has(note.id)?performance.now():0};
  }
  function setupCards() {
    const bounds=wall.getBoundingClientRect(), placed=[];
    for(const card of cardRegistry.values()){
      const id=card.dataset.id,note=notes.find(item=>item.id===id);if(!note)continue;
      const rect=card.getBoundingClientRect();let item=motion.get(id);
      if(!item){item=createMotion(note,rect.width,rect.height);motion.set(id,item);}
      else{item.w=rect.width||item.w;item.h=rect.height||item.h;}
      const maxX=Math.max(0,bounds.width-item.w),maxY=Math.max(0,bounds.height-item.h-62);
      item.x=Math.max(0,Math.min(maxX,item.x));item.y=Math.max(0,Math.min(maxY,item.y));
      card.style.transform=`translate3d(${item.x}px,${item.y}px,0) rotate(${item.rot}deg) scale(${item.depth})`;
      placed.push(item);
    }
  }

  function resizeCanvas() {
    const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
    const count=innerWidth<=520?13:innerWidth<=900?21:30;
    particles=Array.from({length:count},(_,index)=>{const random=randomizer(seed(`p-${index}`));return{x:random()*rect.width,y:random()*rect.height,r:.6+random()*1.5,vx:(random()-.5)*3,vy:-.5-random()*2.2,a:.12+random()*.18,phase:random()*6.28};});
  }
  function drawParticles(dt, now) {
    const rect=canvas.getBoundingClientRect();ctx.clearRect(0,0,rect.width,rect.height);
    if(flowAmount>.015){
      ctx.save();ctx.lineWidth=1;ctx.lineCap="round";
      const steps=Math.ceil(rect.width/42),phase=now*.00028;
      for(let lane=0;lane<6;lane++){
        const center=rect.height*(.08+lane*.17),offset=lane*1.13;
        ctx.beginPath();
        for(let step=0;step<=steps;step++){const x=step*42,y=center+Math.sin(x*.0034+phase+offset)*19+Math.sin(x*.008-phase*.8+offset*.8)*8+Math.sin(x*.014+phase*.52+offset*1.7)*3;step===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        ctx.strokeStyle=`rgba(96,165,250,${flowAmount*.09})`;ctx.stroke();
        ctx.beginPath();
        for(let step=0;step<=steps;step++){const x=step*42,y=center+8+Math.sin(x*.0034+phase+offset)*19+Math.sin(x*.008-phase*.8+offset*.8)*8+Math.sin(x*.014+phase*.52+offset*1.7)*3;step===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        ctx.strokeStyle=`rgba(234,243,255,${flowAmount*.035})`;ctx.stroke();
      }
      ctx.restore();
    }
    if(reducedMotion.matches){for(const p of particles){ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`rgba(180,205,239,${p.a*.5})`;ctx.fill();}return;}
    for(const p of particles){const currentX=Math.sin(p.y*.004+now*.00035+p.phase)*1.8,currentY=Math.cos(p.x*.003-now*.00028+p.phase)*.75;p.x+=(p.vx+currentX)*dt;p.y+=(p.vy+currentY)*dt;if(p.y<-4){p.y=rect.height+4;p.x=Math.random()*rect.width;}if(p.x<-4)p.x=rect.width+4;if(p.x>rect.width+4)p.x=-4;const pulse=.75+.25*Math.sin(now*.0005+p.phase);ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`rgba(150,190,242,${p.a*pulse})`;ctx.fill();}
  }
  function edgeSteering(position,maxPosition,range,strength){
    if(maxPosition<2)return 0;
    const nearStart=Math.max(0,1-position/range),nearEnd=Math.max(0,1-(maxPosition-position)/range);
    return nearStart*nearStart*(.35+nearStart*.65)*strength-nearEnd*nearEnd*(.35+nearEnd*.65)*strength;
  }
  function updateSeparation(items,gap,density){
    const widths=items.map(item=>item.w),heights=items.map(item=>item.h),maxDimension=Math.max(48,...widths,...heights),cellSize=maxDimension+gap+64,softRange=38+gap*1.6;
    const buckets=new Map(),order=new Map(items.map((item,index)=>[item,index]));
    for(const item of items){item.targetSepX=0;item.targetSepY=0;const cx=Math.floor((item.x+item.w/2)/cellSize),cy=Math.floor((item.y+item.h/2)/cellSize),key=`${cx},${cy}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(item);}
    const crowdFactor=density==="miniature"?.2:density==="galaxy"?.34:density==="packed"?.86:density==="many"?.72:density==="moderate"?.54:.34;
    const neighborLimit=density==="miniature"?18:density==="galaxy"?30:56;
    for(const a of items){
      const ax=Math.floor((a.x+a.w/2)/cellSize),ay=Math.floor((a.y+a.h/2)/cellSize);
      let checked=0;
      neighborSearch:for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
        const neighbors=buckets.get(`${ax+ox},${ay+oy}`);if(!neighbors)continue;
        for(const b of neighbors){if(order.get(b)<=order.get(a))continue;if(checked++>=neighborLimit)break neighborSearch;
          const dx=(b.x+b.w/2)-(a.x+a.w/2),dy=(b.y+b.h/2)-(a.y+a.h/2),absX=Math.abs(dx),absY=Math.abs(dy);
          const clearX=absX-(a.w+b.w)/2,clearY=absY-(a.h+b.h)/2;
          if(clearX>=softRange||clearY>=softRange)continue;
          let nx,ny,penetration=Math.max(0,-clearX,-clearY);
          if(clearX<0&&clearY<0){if(-clearX < -clearY){nx=Math.sign(dx)||Math.sign(Math.cos(a.phase-b.phase))||1;ny=0;}else{nx=0;ny=Math.sign(dy)||Math.sign(Math.sin(a.phase-b.phase))||1;}}
          else if(clearX<0){nx=0;ny=Math.sign(dy)||Math.sign(Math.sin(a.phase-b.phase))||1;}
          else if(clearY<0){nx=Math.sign(dx)||Math.sign(Math.cos(a.phase-b.phase))||1;ny=0;}
          else{const distance=Math.hypot(dx,dy)||1;nx=dx/distance;ny=dy/distance;}
          const clearance=Math.max(0,clearX,clearY),proximity=1-Math.min(1,clearance/softRange),force=Math.min(15,penetration*.045+3+proximity*6)*crowdFactor;
          a.targetSepX-=nx*force;a.targetSepY-=ny*force;b.targetSepX+=nx*force;b.targetSepY+=ny*force;
        }
      }
    }
    for(const item of items){const length=Math.hypot(item.targetSepX,item.targetSepY);if(length>14){item.targetSepX*=14/length;item.targetSepY*=14/length;}}
  }
  function animate(now) {
    frameId=0;if(document.hidden)return;
    const dt=reducedMotion.matches?0:Math.min(.05,(now-lastFrame)/1000||.016);lastFrame=now;
    if(!reducedMotion.matches){
      const rect=wall.getBoundingClientRect(), items=[...cardRegistry.keys()].map(id=>motion.get(id)).filter(Boolean), t=now/1000,flow=.48+flowAmount*.82,density=wall.dataset.density,densitySpeed=density==="miniature"?.5:density==="galaxy"?.68:density==="packed"?.82:density==="many"?.9:density==="moderate"?.98:1.04;
      const collisionInterval=items.length>180?320:items.length>100?220:144;
      if(now-lastCollisionAt>collisionInterval){lastCollisionAt=now;updateSeparation(items,spacingForDensity(),density);}
      for(const item of items){
        const selected=detailOpen&&item===motion.get(selectedId),targetInteraction=item.hovered ? 0 : selected ? 0 : detailOpen ? .32 : 1;
        item.interaction+=(targetInteraction-item.interaction)*Math.min(1,dt*4.2);
        const currentPhase=t*item.flowRate+item.flowPhase,spatialX=item.x*.0031+item.y*.0018,spatialY=item.y*.0028-item.x*.0016;
        const swirl=Math.sin(spatialX*.78+currentPhase)+Math.cos(spatialY*.84-currentPhase*.72+item.flowPhase*.3);
        const currentX=(Math.sin(spatialY+currentPhase*.72+item.flowPhase)+Math.cos(spatialX*.62-currentPhase*.5+item.phase)*.48+Math.sin(spatialX*.34+spatialY*.46-t*item.turnRate)*.38)*16*flow;
        const currentY=(Math.cos(spatialX+currentPhase*.78+item.phase)+Math.sin(spatialY*.68-currentPhase*.56+item.flowPhase)*.44+Math.cos(spatialY*.38-spatialX*.48-t*item.turnRate+swirl)*.34)*14*flow;
        const wanderX=Math.sin(t*item.driftRate+item.phase)*item.driftX+Math.sin(t*item.turnRate+item.flowPhase)*item.driftX*.42,wanderY=Math.cos(t*item.driftRate*.83+item.flowPhase)*item.driftY+Math.sin(t*item.turnRate*.76+item.phase)*item.driftY*.38;
        const maxX=Math.max(0,rect.width-item.w),maxY=Math.max(0,rect.height-item.h-62),edgeX=Math.max(92,Math.min(190,maxX*.32)),edgeY=Math.max(78,Math.min(165,maxY*.32));
        const boundaryX=edgeSteering(item.x,maxX,edgeX,42),boundaryY=edgeSteering(item.y,maxY,edgeY,36),steerEase=1-Math.exp(-dt*(1.55+item.flowRate*.65));
        item.sepX+=(item.targetSepX-item.sepX)*Math.min(1,dt*4.8);item.sepY+=(item.targetSepY-item.sepY)*Math.min(1,dt*4.8);
        const desiredX=item.baseVx*.48+currentX+wanderX+item.sepX+boundaryX,desiredY=item.baseVy*.48+currentY+wanderY+item.sepY+boundaryY;
        item.vx+=(desiredX-item.vx)*steerEase;item.vy+=(desiredY-item.vy)*steerEase;
        const ramp=item.born?Math.min(1,(now-item.born)/900):1, ease=.35+.65*ramp*ramp*(3-2*ramp);
        const movement=densitySpeed*item.interaction*ease;
        item.x+=item.vx*dt*movement;item.y+=item.vy*dt*movement;
        if(item.x<0){item.x=0;item.vx=Math.max(0,item.vx);}else if(item.x>maxX){item.x=maxX;item.vx=Math.min(0,item.vx);}
        if(item.y<0){item.y=0;item.vy=Math.max(0,item.vy);}else if(item.y>maxY){item.y=maxY;item.vy=Math.min(0,item.vy);}
      }
      const rotationFactor=density==="miniature"?.12:density==="galaxy"?.2:density==="packed"?.25:density==="many"?.4:density==="moderate"?.68:1;
      for(const [id,card] of cardRegistry){const item=motion.get(id);if(!item)continue;let px=0,py=0;if(pointer.active){const cx=item.x+item.w/2,cy=item.y+item.h/2,dx=cx-pointer.x,dy=cy-pointer.y,distance=Math.hypot(dx,dy);if(distance<230&&distance>1){const amount=(1-distance/230)*5*item.depth;px=dx/distance*amount;py=dy/distance*amount;}}const scale=item.depth+Math.sin(t*.4+item.phase)*.003,swayAmplitude=item.layer==="foreground"?.62:item.layer==="background"?.22:.4,sway=Math.sin(t*item.turnRate*.8+item.flowPhase)*swayAmplitude*rotationFactor*item.interaction;card.style.transform=`translate3d(${(item.x+px).toFixed(1)}px,${(item.y+py).toFixed(1)}px,0) rotate(${(item.rot*rotationFactor+sway).toFixed(2)}deg) scale(${scale.toFixed(3)})`;}
    }
    flowAmount+=(targetFlow()-flowAmount)*Math.min(1,dt*1.35);
    drawParticles(dt,now);startMotion();
  }
  function startMotion(){if(!frameId&&!document.hidden&&!reducedMotion.matches)frameId=requestAnimationFrame(animate);}
  function launchArrival(note){if(reducedMotion.matches){render();return;}arrivalIds.add(note.id);const item=motion.get(note.id);if(item)motion.delete(note.id);render();const card=cardRegistry.get(note.id),m=motion.get(note.id);if(card&&m)emitPulse(m.x+m.w/2,m.y+m.h/2);}
  function emitPulse(x,y){const pulse=document.createElement("span");pulse.className="entry-pulse";pulse.style.left=`${x}px`;pulse.style.top=`${y}px`;wall.append(pulse);for(let i=0;i<5;i++){const spark=document.createElement("i");spark.className=`entry-spark spark-${i}`;spark.style.left=`${x}px`;spark.style.top=`${y}px`;wall.append(spark);setTimeout(()=>spark.remove(),850);}setTimeout(()=>pulse.remove(),950);}
  function emitReplyActivity(noteId,replyId){if(replyId){if(animatedReplyIds.has(replyId))return;animatedReplyIds.add(replyId);if(animatedReplyIds.size>500)animatedReplyIds.delete(animatedReplyIds.values().next().value);}const card=cardRegistry.get(noteId),item=motion.get(noteId);if(!card||!item)return;card.classList.add("reply-activity");emitPulse(item.x+item.w/2,item.y+item.h/2);setTimeout(()=>card.classList.remove("reply-activity"),2600);}
  function removeNote(id){notes=notes.filter(note=>note.id!==id);motion.delete(id);const card=cardRegistry.get(id);if(card){resizeObserver.unobserve(card);card.remove();}cardRegistry.delete(id);render();}
  function clientId(){let value=localStorage.getItem(CLIENT_KEY);if(!value){value=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;localStorage.setItem(CLIENT_KEY,value);}return value;}

  function openComposer(){$("composer-form").reset();$("note-author").value=localStorage.getItem(AUTHOR_KEY)||"";$("character-count").textContent="0 / 500";$("composer-error").hidden=true;$("note-content").removeAttribute("aria-invalid");composer.showModal();setTimeout(()=>$("note-content").focus(),50);}
  function openDetail(note,card){
    if(!note)return;card=card||cardRegistry.get(note.id);if(!card)return;
    clearTimeout(discoveryTimer);discoveryId=null;
    currentDetail=note;selectedId=note.id;activeConversationId=note.id;detailOpen=true;universe.classList.add("detail-open");
    detail.dataset.tone=tones[seed(note.id)%tones.length];
    const rect=card.getBoundingClientRect();detail.style.setProperty("--origin-x",`${rect.left+rect.width/2-innerWidth/2}px`);detail.style.setProperty("--origin-y",`${rect.top+rect.height/2-innerHeight/2}px`);card.classList.add("selected");
    $("detail-category").textContent=note.category||"A thought";$("detail-title").textContent=note.title||"A thought from the wall";$("detail-recipient").textContent=note.recipient?`To: ${note.recipient}`:"";$("detail-recipient").hidden=!note.recipient;$("detail-content").textContent=note.content;$("detail-author").textContent=authorName(note);const detailAvatar=$("detail-avatar");detailAvatar.classList.toggle("anonymous",Boolean(note.anonymous));if(note.anonymous)detailAvatar.innerHTML=anonymousIcon;else detailAvatar.textContent=authorName(note).trim().charAt(0).toUpperCase()||"•";$("detail-time").textContent=new Date(Number(note.createdAt)||Date.now()).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});updateDetailCounts(note);
    $("reply-form").hidden=false;$("reply-error").hidden=true;$("reply-author").value=localStorage.getItem(AUTHOR_KEY)||"";$("reply-anonymous").checked=false;$("reply-content").value=replyDrafts.get(note.id)||"";
    renderReplies(note.id,replyCache.has(note.id)?"ready":"loading");detail.showModal();loadReplies(note);
  }
  function updateDetailCounts(note){
    if(!note)return;const button=$("detail-like"),isLiked=liked.has(note.id),count=Number(note.likes)||0;
    $("detail-like-count").textContent=String(count);$("reply-count").textContent=String(Number(note.replyCount)||0);$("detail-reply-total").textContent=String(Number(note.replyCount)||0);
    button.classList.toggle("liked",isLiked);button.setAttribute("aria-pressed",String(isLiked));button.setAttribute("aria-label",`${isLiked?"Unlike":"Like"} this note, ${count} likes`);
  }
  function dateLabel(value){return new Date(Number(value)||Date.now()).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
  function renderReplies(noteId,state="ready"){
    const list=$("replies-list"),note=notes.find(item=>item.id===noteId),replies=(replyCache.get(noteId)||[]).slice().sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));
    $("reply-count").textContent=String(note?.replyCount??replies.length);$("detail-reply-total").textContent=String(note?.replyCount??replies.length);
    if(state==="loading"&&!replies.length){list.innerHTML='<div class="reply-loading">Gathering repliesâ€¦</div>';return;}
    if(state==="error"&&!replies.length){list.innerHTML='<div class="reply-empty">Replies couldnâ€™t load. <button type="button" id="retry-replies">Try again</button></div>';return;}
    if(!replies.length){list.innerHTML='<div class="reply-empty">No replies yet. Be the first to share your thoughts.</div>';return;}
    list.innerHTML=replies.map(reply=>`<article class="reply-item" data-reply-id="${escapeHtml(reply.id)}"><div class="reply-item-top"><span class="reply-author">${escapeHtml(reply.anonymous?"Someone, anonymously":reply.author||"Someone")}</span><time datetime="${new Date(Number(reply.createdAt)||Date.now()).toISOString()}">${dateLabel(reply.createdAt)}</time></div><p>${escapeHtml(reply.content)}</p></article>`).join("");
    list.scrollTop=list.scrollHeight;
  }
  async function loadReplies(note){
    const token=++replyLoadToken;
    try{let replies;if(remoteMode){const response=await fetch(`/api/notes/${encodeURIComponent(note.id)}/replies`,{headers:{Accept:"application/json"}});if(!response.ok)throw new Error();replies=await response.json();if(!Array.isArray(replies))throw new Error();}else replies=Array.isArray(note.replies)?note.replies:[];
      if(token!==replyLoadToken)return;const latest=replyCache.get(note.id)||[];const merged=new Map(latest.map(reply=>[reply.id,reply]));for(const reply of replies)merged.set(reply.id,reply);replies=[...merged.values()].sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));replyCache.set(note.id,replies);note.replyCount=Math.max(Number(note.replyCount)||0,replies.length);if(!remoteMode)saveLocal();renderReplies(note.id);render();
    }catch{if(token===replyLoadToken)renderReplies(note.id,"error");}
  }
  function addReply(reply,noteId){const list=replyCache.get(noteId)||[];if(!list.some(item=>item.id===reply.id))list.push(reply);replyCache.set(noteId,list);const note=notes.find(item=>item.id===noteId);if(note)note.replyCount=Math.max(Number(note.replyCount)||0,list.length);if(activeConversationId===noteId)renderReplies(noteId);render();}
  function receiveReply(data){const note=notes.find(item=>item.id===data.noteId);if(!note||!data.reply)return;const list=replyCache.get(note.id)||[];const duplicate=list.some(item=>item.id===data.reply.id);if(!duplicate)list.push(data.reply);replyCache.set(note.id,list);note.replyCount=Number(data.replyCount)||Math.max(Number(note.replyCount)||0,list.length);if(activeConversationId===note.id)renderReplies(note.id);render();if(!duplicate)emitReplyActivity(note.id,data.reply.id);}
  function closeDetail(){if(detail.open){if(detail.classList.contains("closing"))return;detail.classList.add("closing");detailCloseTimer=setTimeout(()=>{detail.classList.remove("closing");detail.close();},260);return;}detailOpen=false;universe.classList.remove("detail-open");if(selectedId)cardRegistry.get(selectedId)?.classList.remove("selected");selectedId=null;currentDetail=null;activeConversationId=null;startMotion();}

  $("write-button").addEventListener("click",openComposer);$("empty-write").addEventListener("click",openComposer);
  $("empty-clear-search").addEventListener("click",()=>{search.value="";search.focus();render();});
  $("empty-view-all").addEventListener("click",()=>{$("date-filter").value="all";$("date-filter").dispatchEvent(new Event("change",{bubbles:true}));});
  document.querySelectorAll(".close-dialog").forEach(button=>button.addEventListener("click",()=>button.closest("dialog").id==="detail-dialog"?closeDetail():button.closest("dialog").close()));
  [composer,detail].forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog){if(dialog===detail)closeDetail();else dialog.close();}}));
  detail.addEventListener("cancel",event=>{event.preventDefault();closeDetail();});
  detail.addEventListener("close",()=>{clearTimeout(detailCloseTimer);detail.classList.remove("closing");detailOpen=false;universe.classList.remove("detail-open");if(selectedId)cardRegistry.get(selectedId)?.classList.remove("selected");selectedId=null;currentDetail=null;activeConversationId=null;startMotion();});
  $("note-content").addEventListener("input",event=>{const field=event.target;$("character-count").textContent=`${field.value.length} / 500`;if(field.value.trim()){$("composer-error").hidden=true;field.removeAttribute("aria-invalid");}});
  $("composer-form").addEventListener("submit",async event=>{
    event.preventDefault();const content=$("note-content").value.trim();if(!content){$("composer-error").hidden=false;$("note-content").setAttribute("aria-invalid","true");$("note-content").focus();return;}$("composer-error").hidden=true;$("note-content").removeAttribute("aria-invalid");
    if(!remoteReady)await remoteLoadPromise;
    const button=$("publish-button"),oldLabel=button.innerHTML;button.disabled=true;button.textContent="Publishing...";
    const author=$("note-author").value.trim().slice(0,40)||"Someone";localStorage.setItem(AUTHOR_KEY,author);
    const recipient=$("note-recipient").value.trim().slice(0,80);
    const payload={title:$("note-title").value.trim(),content,category:$("note-category").value,anonymous:$("note-anonymous").checked,author,recipient};
    try{let note;if(remoteMode){const response=await fetch("/api/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.error||"The server could not save this note.");}note=await response.json();}else note={...payload,id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,createdAt:Date.now(),likes:0};
      search.value="";const alreadyPresent=notes.some(item=>item.id===note.id);if(!alreadyPresent){notes.unshift(note);if(!remoteMode)saveLocal();launchArrival(note);}else{notes=notes.map(item=>item.id===note.id?note:item);render();}
      composer.close();showToast("Your thought has joined the universe.");
    }catch(error){showToast(error instanceof Error?error.message:"The note could not be published. Please try again.");}finally{button.disabled=false;button.innerHTML=oldLabel;}
  });
  search.addEventListener("input",()=>{clearTimeout(discoveryTimer);discoveryId=null;render();});
  document.querySelectorAll(".filter-segment").forEach(button=>button.addEventListener("click",()=>{
    const filter=$("date-filter");filter.value=button.dataset.filter;filter.dispatchEvent(new Event("change",{bubbles:true}));
  }));
  $("date-filter").addEventListener("change",()=>{
    document.querySelectorAll(".filter-segment").forEach(button=>{
      const active=button.dataset.filter===$("date-filter").value;
      button.classList.toggle("is-active",active);button.setAttribute("aria-pressed",String(active));
    });
    clearTimeout(discoveryTimer);discoveryId=null;render();
  });
  wall.addEventListener("click",event=>{
    const card=event.target.closest(".note-card");if(card)openDetail(notes.find(note=>note.id===card.dataset.id),card);
  });
  $("detail-like").addEventListener("click",async()=>{
    const button=$("detail-like"),targetId=currentDetail?.id;if(!targetId||button.disabled)return;button.disabled=true;if(!remoteReady)await remoteLoadPromise;
    const note=notes.find(item=>item.id===targetId);if(!note){button.disabled=false;return;}
    const wasLiked=liked.has(note.id),next=!wasLiked,previousCount=Number(note.likes)||0;
    note.likes=Math.max(0,previousCount+(next?1:-1));if(next)liked.add(note.id);else liked.delete(note.id);localStorage.setItem(LIKE_KEY,JSON.stringify([...liked]));if(!remoteMode)saveLocal();if(activeConversationId===note.id)updateDetailCounts(note);render();
    button.classList.remove("pop");void button.offsetWidth;button.classList.add("pop");setTimeout(()=>button.classList.remove("pop"),420);
    if(remoteMode){try{const response=await fetch(`/api/notes/${encodeURIComponent(note.id)}/like`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({liked:next,clientId:clientId()})});if(!response.ok)throw new Error();note.likes=(await response.json()).likes;if(activeConversationId===note.id)updateDetailCounts(note);render();}catch{note.likes=previousCount;if(wasLiked)liked.add(note.id);else liked.delete(note.id);localStorage.setItem(LIKE_KEY,JSON.stringify([...liked]));if(activeConversationId===note.id)updateDetailCounts(note);render();showToast("Couldnâ€™t update your like. Try again.");}finally{button.disabled=false;}}else button.disabled=false;
  });
  wall.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.classList.contains("note-card")){event.preventDefault();openDetail(notes.find(note=>note.id===event.target.dataset.id),event.target);}});
  $("reply-content").addEventListener("input",event=>{if(activeConversationId)replyDrafts.set(activeConversationId,event.target.value);});
  $("reply-form").addEventListener("submit",async event=>{
    event.preventDefault();const note=currentDetail,content=$("reply-content").value.trim();if(!note||!content){$("reply-content").focus();return;}
    if(!remoteReady)await remoteLoadPromise;
    const author=$("reply-author").value.trim().slice(0,40)||"Someone",anonymous=$("reply-anonymous").checked;
    if(!anonymous)localStorage.setItem(AUTHOR_KEY,author);
    const id=pendingReply?.noteId===note.id&&pendingReply.content===content?pendingReply.id:(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`);
    pendingReply={id,noteId:note.id,content};try{sessionStorage.setItem("notezy-pending-reply-v1",JSON.stringify(pendingReply));}catch{}
    const button=$("send-reply"),oldLabel=button.innerHTML;button.disabled=true;button.textContent="Sendingâ€¦";$("reply-error").hidden=true;
    try{
      let reply;
      if(remoteMode){const response=await fetch(`/api/notes/${encodeURIComponent(note.id)}/replies`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,content,author,anonymous})});if(!response.ok)throw new Error("Reply failed");const result=await response.json();reply=result.reply;note.replyCount=result.replyCount;}
      else{note.replies||=[];reply=note.replies.find(item=>item.id===id);if(!reply){reply={id,noteId:note.id,content,author:anonymous?"":author,anonymous,createdAt:Date.now()};note.replies.push(reply);}note.replyCount=note.replies.length;saveLocal();}
      addReply(reply,note.id);pendingReply=null;try{sessionStorage.removeItem("notezy-pending-reply-v1");}catch{}
      $("reply-content").value="";replyDrafts.delete(note.id);$("reply-anonymous").checked=false;emitReplyActivity(note.id,reply.id);showToast("Your reply joined the conversation.");
    }catch{$("reply-error").textContent="Couldnâ€™t send your reply. Your text is still hereâ€”try again.";$("reply-error").hidden=false;}
    finally{button.disabled=false;button.innerHTML=oldLabel;}
  });
  $("discover-button").addEventListener("click",()=>{
    const query=search.value.trim().toLocaleLowerCase(),pool=filteredNotes();
    if(!pool.length){showToast("No thoughts to discover for this search.");return;}
    const recent=new Set(discoveryHistory.slice(-Math.min(3,pool.length-1))),choices=pool.filter(note=>!recent.has(note.id));
    const chosen=(choices.length?choices:pool)[Math.floor(Math.random()*(choices.length||pool.length))];
    discoveryHistory.push(chosen.id);discoveryHistory=discoveryHistory.slice(-3);discoveryId=chosen.id;render();const card=cardRegistry.get(chosen.id),item=motion.get(chosen.id);if(item)emitPulse(item.x+item.w/2,item.y+item.h/2);showToast("A thought found you.");clearTimeout(discoveryTimer);
    discoveryTimer=setTimeout(()=>{if(!filteredNotes().some(note=>note.id===chosen.id)){discoveryId=null;render();return;}discoveryId=null;selectedId=chosen.id;render();const current=cardRegistry.get(chosen.id);if(current){current.classList.add("discovered");openDetail(chosen,current);setTimeout(()=>current.classList.remove("discovered"),2800);}else{selectedId=null;render();}},700);
  });
  $("replies-list").addEventListener("click",event=>{if(event.target?.id==="retry-replies"&&currentDetail)loadReplies(currentDetail);});
  $("detail-copy").addEventListener("click",async()=>{if(!currentDetail)return;try{await navigator.clipboard.writeText([currentDetail.title,currentDetail.content].filter(Boolean).join("\n\n"));showToast("Copied to clipboard.");}catch{showToast("Clipboard access isnâ€™t available here.");}});
  $("detail-report").addEventListener("click",()=>{if(!currentDetail)return;if(window.confirm("Report this note? It will be hidden from your view on this device.")){hidden.add(currentDetail.id);localStorage.setItem(HIDDEN_KEY,JSON.stringify([...hidden]));if(!remoteMode){notes=notes.filter(note=>note.id!==currentDetail.id);saveLocal();}closeDetail();render();showToast("Note hidden from your view. Thanks for letting us know.");}});
  $("profile-button").addEventListener("click",()=>showToast(remoteMode?"Live shared wall Â· notes sync with connected visitors.":"Local wall Â· notes are saved in this browser."));
  document.addEventListener("keydown",event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();search.focus();}});
  universe.addEventListener("pointermove",event=>{const rect=wall.getBoundingClientRect();pointer.x=event.clientX-rect.left;pointer.y=event.clientY-rect.top;pointer.active=event.pointerType!=="touch";});
  universe.addEventListener("pointerleave",()=>{pointer.active=false;});
  document.addEventListener("visibilitychange",()=>{lastFrame=0;if(document.hidden){if(frameId)cancelAnimationFrame(frameId);frameId=0;}else startMotion();});
  reducedMotion.addEventListener?.("change",()=>{lastFrame=0;if(reducedMotion.matches){if(frameId)cancelAnimationFrame(frameId);frameId=0;flowAmount=targetFlow();drawParticles(0,0);}else startMotion();});
  const resizeObserver=new ResizeObserver(entries=>{let wallResized=false;for(const entry of entries){if(entry.target===wall){wallResized=true;continue;}const item=motion.get(entry.target.dataset.id);if(item){const rect=entry.target.getBoundingClientRect();item.w=rect.width||item.w;item.h=rect.height||item.h;}}if(wallResized){clearTimeout(layoutResizeTimer);layoutResizeTimer=setTimeout(()=>{resizeCanvas();render();},80);}else startMotion();});resizeObserver.observe(wall);
  window.addEventListener("pagehide",()=>{resizeObserver.disconnect();eventSource?.close();if(frameId)cancelAnimationFrame(frameId);});

  async function loadRemote(){
    try{const response=await fetch("/api/notes",{headers:{Accept:"application/json"}});if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data))throw new Error();notes=data;remoteMode=true;setConnection("connected","Live");render();connectEvents();}
    catch{remoteMode=location.protocol!=="file:";if(remoteMode)setConnection("","Reconnecting");else setConnection("local","Local wall");render();}
    finally{remoteReady=true;render();}
  }
  function connectEvents(){if(!remoteMode||!("EventSource"in window))return;eventSource?.close();eventSource=new EventSource("/api/events");eventSource.addEventListener("open",()=>setConnection("connected","Live"));eventSource.addEventListener("error",()=>setConnection("","Reconnecting"));eventSource.addEventListener("sync",()=>{refreshRemoteNotes();});eventSource.addEventListener("note:created",event=>{try{upsertNote(JSON.parse(event.data));}catch{}});eventSource.addEventListener("note:updated",event=>{try{upsertNote(JSON.parse(event.data));}catch{}});eventSource.addEventListener("note:deleted",event=>{try{const data=JSON.parse(event.data);removeNote(typeof data==="string"?data:data.id);}catch{}});eventSource.addEventListener("reply:created",event=>{try{receiveReply(JSON.parse(event.data));}catch{}});}
  let remoteSyncPromise=null;
  async function refreshRemoteNotes(){if(!remoteMode||remoteSyncPromise)return remoteSyncPromise;remoteSyncPromise=(async()=>{try{const response=await fetch("/api/notes",{headers:{Accept:"application/json"}});if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data))throw new Error();const previousIds=new Set(notes.map(note=>note.id)),nextIds=new Set(data.map(note=>note.id));for(const note of notes)if(!nextIds.has(note.id))motion.delete(note.id);notes=data;if(currentDetail){currentDetail=notes.find(note=>note.id===currentDetail.id)||currentDetail;updateDetailCounts(currentDetail);if(activeConversationId&&notes.some(note=>note.id===activeConversationId))loadReplies(currentDetail);}setConnection("connected","Live");render();for(const note of data)if(!previousIds.has(note.id))launchArrival(note);}catch{setConnection("","Reconnecting");}finally{remoteSyncPromise=null;}})();return remoteSyncPromise;}
  function upsertNote(note){if(notes.some(item=>item.id===note.id)){notes=notes.map(item=>item.id===note.id?{...item,...note}:item);render();}else{notes.unshift(note);launchArrival(note);}}

  resizeCanvas();drawParticles(0,0);render();remoteLoadPromise=loadRemote();
  const refreshTimer=setInterval(()=>{if(!remoteMode||document.hidden||composer.open||detail.open)return;refreshRemoteNotes();if(!eventSource)connectEvents();},30000);
  const timeTimer=setInterval(()=>{for(const time of wall.querySelectorAll(".note-time")){const note=notes.find(item=>item.id===time.closest(".note-card")?.dataset.id);if(note)time.textContent=timeAgo(note.createdAt);}},60000);
  window.addEventListener("pagehide",()=>{clearInterval(refreshTimer);clearInterval(timeTimer);});
})();
