(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const call = (channel, ...args) => invoke('dispatch', { channel, args });
  const send = (channel, ...args) => { void call(channel, ...args).catch(console.error); };
  const listeners = [];
  const on = (name, callback) => {
    let disposed = false, stop;
    const pending = listen(name, event => { if (!disposed) callback(event.payload); }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    listeners.push(pending);
    return () => { disposed = true; stop?.(); };
  };
  window.appPreferences = { get: () => call('app-preferences:get'), setLogin: enabled => call('app-preferences:login', enabled), resetPosition: () => call('app-preferences:reset-position'), copyInfo: () => call('app-preferences:copy-info') };
  window.petVisibility = { onChanged: callback => { callback(true); return on('pet:visibility', callback); } };
  window.modules = { get: () => call('modules:get'), set: (key, enabled) => call('modules:set', { key, enabled }), onChanged: cb => on('modules:changed', cb) };
  window.appearance = { get: () => call('appearance:get'), set: (key, value) => call('appearance:set', { key, value }), onChanged: cb => on('appearance:changed', cb) };
  let dragQueue = Promise.resolve();
  const drag = (...args) => { dragQueue = dragQueue.then(() => call('pet:drag', ...args)).catch(console.error); };
  window.petDrag = { start: (x,y) => drag('start', {x,y}), move: (x,y) => drag('move', {x,y}), end: () => drag('end'), onReset: cb => on('pet:position-reset', cb) };
  window.petInput = { updateRegion: region => send('pet:hit-region', region) };
  window.petPanel = { toggle: () => send('pet:panel-toggle'), close: () => send('panel:close'), onState: cb => on('pet:panel-state', cb) };
  window.utilityPanel = { close: () => send('panel:close'), ready: () => { void Promise.all(listeners).then(() => send('panel:ready')); }, setView: view => send('panel:view', view), onOpen: cb => on('panel:opened', cb) };
  window.resultTools = { copy: text => call('results:copy', text), react: outcome => send('results:react', outcome), onReaction: cb => on('results:reaction', cb) };
  window.ports = { list: () => call('ports:list'), open: (pid,port) => call('ports:open', {pid,port}), terminate: (pid,port) => call('ports:terminate', {pid,port}), onReaction: cb => on('ports:reaction', cb) };
  window.food = {
    saveText: text => call('food:save-text', text),
    async saveFiles(files) {
      if (!Array.isArray(files) || files.length > 10) return { ok:false, error:'파일은 한 번에 10개까지 먹일 수 있어요.' };
      const initial = await window.modules.get();
      if (!initial.ok || !initial.value.modules.m01) return {ok:false,error:'먹이·변환이 꺼져 있어요.'};
      const items=[], errors=[];
      for (const file of files) {
        if (file.size > 25*1024*1024) { errors.push(`${file.name}: 파일은 개당 25MB까지 저장할 수 있어요.`); continue; }
        const nameBytes=new TextEncoder().encode(file.name);
        const encodedName=btoa(String.fromCharCode(...nameBytes));
        try {
          const response=await invoke('save_file', await file.arrayBuffer(), {headers:{'x-bytepet-name':encodedName,'x-bytepet-epoch':String(initial.value.epochs.m01)}});
          if(response.ok) items.push(response.value); else errors.push(`${file.name}: ${response.error}`);
        } catch(error) { errors.push(`${file.name}: ${String(error)}`); }
      }
      return {ok:true,value:{items,errors}};
    },
    list: options => call('food:list', options ?? {}), thumbnail: (id,trash=false) => call('food:thumbnail',{id,trash}), preview: (id,trash=false) => call('food:preview',{id,trash}), rename:(id,name)=>call('food:rename',{id,name}), trash:id=>call('food:trash',id), restore:id=>call('food:restore',id), menu: async (id,trash=false) => { const item=await call('food:menu',{id,trash}); if(!item.ok) return item; return {ok:true,value:await contextMenu(item.value,trash)}; },
    readText:id=>call('food:read-text',id),open:id=>call('food:open',id),reveal:id=>call('food:reveal',id),folder:()=>call('food:folder'),onChanged:cb=>on('food:changed',cb),onSaved:cb=>on('food:saved',cb)
  };
  let menuPoint, closeMenu;
  document.addEventListener('contextmenu', event => { menuPoint={x:event.clientX,y:event.clientY}; }, true);
  function contextMenu(item, trash) {
    closeMenu?.(null);
    return new Promise(resolve => {
      const previous=document.activeElement;
      const menu=document.createElement('div'); menu.className='tauri-context-menu'; menu.setAttribute('role','menu');
      const choices=trash ? [['미리보기','preview'],['보관함으로 복원','restore']] : [
        [item.kind==='text'?'텍스트 불러오기':'파일 열기','food'],['미리보기','preview'],
        ...(item.kind==='text'?[['변환으로 보내기','convert']]:[]),['보관함 이름 변경…','rename'],['폴더에서 보기','reveal'],['휴지통으로 이동','trash']];
      const finish=value=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);window.removeEventListener('blur',cancel);closeMenu=null;previous?.focus({preventScroll:true});resolve(value);};
      closeMenu=finish;
      const outside=event=>{if(!menu.contains(event.target))finish(null);};
      const cancel=()=>finish(null);
      const keyboard=event=>{if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();finish(null);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...menu.querySelectorAll('button')];const current=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}};
      for(const [label,value] of choices){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=label;button.addEventListener('click',()=>finish(value));menu.append(button);}
      document.body.append(menu);const rect=previous?.getBoundingClientRect();const point=menuPoint??{x:rect?.left??20,y:rect?.bottom??120};menuPoint=null;
      menu.style.left=`${Math.max(4,Math.min(point.x,innerWidth-menu.offsetWidth-4))}px`;menu.style.top=`${Math.max(4,Math.min(point.y,innerHeight-menu.offsetHeight-4))}px`;
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);window.addEventListener('blur',cancel);menu.firstElementChild.focus();
    });
  }
  document.addEventListener('DOMContentLoaded', () => { if(document.querySelector('#pet')) document.addEventListener('contextmenu', event => { event.preventDefault(); send('pet:menu'); }); });
  window.aiUsage = {get:()=>call('usage:get'),refresh:()=>call('usage:refresh'),set:(key,value)=>call('usage:set',key,value),connectClaude:enabled=>call('usage:claude-connect',enabled),open:()=>send('usage:open'),onChanged:cb=>on('usage:changed',cb)};
})();
