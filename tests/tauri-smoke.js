(async () => {
  const checks=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message);};
  const call=async(channel,...args)=>{const result=await __TAURI__.core.invoke('dispatch',{channel,args});if(!result.ok)throw new Error(`${channel}: ${result.error}`);return result.value;};
  try {
    await sleep(250);
    assert(document.querySelector('#character-picker').children.length===6,'six character previews loaded');
    assert(!document.querySelector('#food-view').hidden,'food view starts visible');
    const first=await call('test:snapshot');
    assert(first.panel.height===588,'native panel has full height');
    assert(first.region.alpha.some(v=>v>0),'pet rendered sprite and reported alpha hit region');
    assert(first.badgeVisible,'usage badge stays visible without hover');
    assert(first.badgeNative.level>5&&!first.badgeNative.hidesOnDeactivate,'gauge has independent foreground level and survives app deactivation');
    for(const view of ['ports','convert','usage','settings','food']) {
      document.querySelector(`#show-${view}`).click();await sleep(120);
      const next=await call('test:snapshot');assert(next.panel.height===first.panel.height,`${view}: native panel height stays stable`);
      assert(next.badgeNative.visible&&next.badgeNative.level>5,`${view}: gauge remains above focused pet/menu`);
    }
    const source='타우리 테스트\n한글 원문은 그대로 유지합니다.\n{"answer":42}';
    const saved=await food.saveText(source);assert(saved.ok&&saved.value.items.length===1,'text feeding stores item');
    const id=saved.value.items[0].id;
    assert((await food.readText(id)).value===source,'exact UTF-8 text roundtrip');
    assert((await food.list({query:'원문'})).value.some(v=>v.id===id),'search includes full text');
    assert((await food.rename(id,'바뀐 이름')).ok,'rename item');
    assert((await food.trash(id)).ok,'move to trash');
    assert((await food.list({trash:true})).value.some(v=>v.id===id),'trash listing');
    assert((await food.restore(id)).ok,'restore item');
    const file=new File([new Uint8Array([0,255,10,128])],'바이너리.bin',{type:'application/octet-stream'});
    const binary=await food.saveFiles([file]);assert(binary.ok&&binary.value.items[0].size===4,'browser File bytes stored');
    const image=await fetch('./assets/characters/cat-cheese/idle.png').then(r=>r.blob());
    const picture=await food.saveFiles([new File([image],'고양이.png',{type:'image/png'})]);
    assert(picture.ok,'PNG file stored');
    const preview=await food.preview(picture.value.items[0].id);assert(preview.ok&&preview.value.kind==='image','native thumbnail preview');
    const chosen=food.menu(id);await sleep(100);document.querySelector('.tauri-context-menu button').click();assert((await chosen).value==='food','context menu returns action');
    const cancelled=food.menu(id);await sleep(100);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert((await cancelled).value===null,'context menu cancellation settles');
    await modules.set('m01',false);assert(!(await food.saveText('blocked')).ok,'disabled food blocks backend writes');await modules.set('m01',true);
    for(const character of ['cat-black','cat-tuxedo','dog-shiba','dog-corgi','dog-retriever','cat-cheese'])assert((await appearance.set('character',character)).ok,`character switch: ${character}`);
    await appearance.set('menuSide','right');await appearance.set('ground',false);await sleep(100);
    assert((await call('test:snapshot')).pet.width===128,'hide ground resizes native yard');
    await appearance.set('ground',true);await appearance.set('menuSide','left');
    await aiUsage.set('badgeMode','hidden');assert(!(await call('test:snapshot')).badgeVisible,'badge hide setting');
    await aiUsage.set('badgeMode','always');assert((await call('test:snapshot')).badgeVisible,'badge always setting');
    const portList=await ports.list();assert(portList.ok&&Array.isArray(portList.value.items),'native lsof port listing');
    await modules.set('m02',false);assert(!(await ports.list()).ok,'disabled ports blocks backend scan');await modules.set('m02',true);
    document.querySelector('#show-convert').click();const input=document.querySelector('#convert-draft');input.value='{"answer":42}';input.dispatchEvent(new Event('input',{bubbles:true}));await sleep(100);
    assert(!document.querySelector('#convert-view').hidden,'conversion UI available in WKWebView');
    const prefs=await appPreferences.get();assert(prefs.ok&&!prefs.value.login.available,'isolated profile cannot change login items');
    assert((await appPreferences.resetPosition()).ok,'reset native position');
    await call('test:report',{ok:true,checks});
  } catch(error) {await __TAURI__.core.invoke('dispatch',{channel:'test:report',args:[{ok:false,error:String(error.stack||error),checks}]});}
})();
