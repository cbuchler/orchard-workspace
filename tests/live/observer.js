import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
const XML='<node><interface name="org.gnome.Shell.Extensions.OrchardActivationTest"><method name="Snapshot"><arg type="s" direction="out"/></method><method name="Setup"><arg type="i" direction="in"/></method><method name="Prepare"/><method name="Activate"/><method name="ExitFullscreen"/><method name="Capture"><arg type="s" direction="in"/></method></interface></node>';
export default class Observer extends Extension {
 enable(){
  this.total=0;this.rawSignals=0;this.started=false;this.error=null;this.returned=false;this.samples=[];this.captureErrors=[];this.captureComplete=[];this.sampleSource=0;
  this.lastWorkspace=global.workspace_manager.get_active_workspace();
  this.signal=global.workspace_manager.connect('active-workspace-changed',()=>{
   const workspace=global.workspace_manager.get_active_workspace();
   if(this.started){this.rawSignals++;if(workspace!==this.lastWorkspace)this.total++;}
   this.lastWorkspace=workspace;
  });
  this.bus=Gio.DBusExportedObject.wrapJSObject(XML,this);
  this.bus.export(Gio.DBus.session,'/org/gnome/Shell/Extensions/OrchardActivationTest');
 }
 windows(){return global.get_window_actors().map(actor=>actor.meta_window).filter(w=>w.get_title()?.startsWith('ORCHARD FIXTURE'));}
 state(){return Main.extensionManager.lookup('orchard-workspace@cbuchler.github.io')?.stateObj?._state;}
 identity(workspace){
  if(!workspace)return null;
  this.identities??=new Map();
  if(!this.identities.has(workspace))this.identities.set(workspace,this.identities.size);
  return this.identities.get(workspace);
 }
 Snapshot(){
  const manager=global.workspace_manager,state=this.state();
  const order=state?.lifecycle.orderForMonitor(this.monitor);
  const owner=this.windows().find(w=>w.get_title().endsWith('0'));
  const fs=state?.lifecycle.windows.get(owner)?.fullscreen;
  const expected=[0,1,2,3].map(i=>({monitor:i<2?this.monitor:1-this.monitor,
   workspace:this.fixtureWorkspaces?.[i]}));
  expected.forEach((fixture,i)=>{fixture.monitor=this.fixtureMonitors?.[i]??fixture.monitor;});
  const fixtureReady=this.windows().length===4&&this.windows().every(w=>{
   const fixture=expected[Number(w.get_title().at(-1))];
   return fixture&&w.get_monitor()===fixture.monitor&&w.get_workspace()===fixture.workspace;
  });
  const focusReady=Main.overview.visible||global.display.focus_window===this.windows().find(w=>w.get_title().endsWith(String(this.focusFixture??0)));
  return JSON.stringify({active:manager.get_active_workspace_index(),count:manager.get_n_workspaces(),
   activeIdentity:this.identity(manager.get_active_workspace()),
   rightNeighborIdentity:this.identity(manager.get_active_workspace().get_neighbor(Meta.MotionDirection.RIGHT)),
   candidateActive:!!state,fixtureReady:fixtureReady&&focusReady,captureErrors:this.captureErrors,captureComplete:this.captureComplete,samples:this.samples,interrupted:this.interrupted,
   pendingMovingWindow:Main.wm._workspaceAnimation.movingWindow?.get_title()??null,
   focus:global.display.focus_window?.get_title(),pointer:global.get_pointer().slice(0,2),
   targetMonitor:this.monitor,case:this.scenario,total:this.total,rawWorkspaceSignals:this.rawSignals,error:this.error,returned:this.returned,
   actorsReused:this.actorsReused,
   removalResult:this.removalResult,removedRetired:this.origin?.retired??false,
   targetSlotCount:order?.slots.length,fullscreenOwners:order?.slots.filter(slot=>slot.owner).length,
   removalOrderPreserved:!!this.beforeSlots&&this.removalOrderPreserved(order),
   modal:Main.modalCount,blocks:Main.wm._blockCount??(Main.wm._workspaceTracker._pauseWorkspaceCheck?1:0),switching:!!Main.wm._workspaceAnimation._switchData,
   targetOrder:state?.lifecycle.orderForMonitor(this.monitor)?.workspaces.map(ws=>ws.index()),
   targetOrderIdentities:state?.lifecycle.orderForMonitor(this.monitor)?.workspaces.map(ws=>this.identity(ws)),
   otherOrder:state?.lifecycle.orderForMonitor(1-this.monitor)?.workspaces.map(ws=>ws.index()),
   otherSlotPreserved:this.otherSlot?state?.lifecycle.orderForMonitor(1-this.monitor)?.slots[0]===this.otherSlot:null,
   otherSlotActive:this.otherSlot?.workspace===manager.get_active_workspace(),
   originActive:this.origin?.workspace===manager.get_active_workspace(),
   orderRestored:!!this.beforeSlots&&order?.slots.length===this.beforeSlots.length&&order.slots.every((slot,i)=>slot===this.beforeSlots[i]),
   fullscreen:fs?{originPosition:order.slots.indexOf(fs.origin),temporaryPosition:order.slots.indexOf(fs.slot),sameOrigin:fs.origin===this.origin,
    unrelatedOrderPreserved:order.slots.filter(slot=>slot!==fs.slot).every((slot,i)=>slot===this.beforeSlots[i])}:null,
   windows:this.windows().map(w=>({title:w.get_title(),monitor:w.get_monitor(),workspace:w.get_workspace()?.index(),
    workspaceIdentity:this.identity(w.get_workspace()),
    visible:w.get_compositor_private()?.visible,onActive:w.located_on_workspace(manager.get_active_workspace()),fullscreen:w.is_fullscreen()})),
   extensions:[...Main.extensionManager._extensions].map(([id,e])=>[id,e.state])});
 }
 Setup(monitor){
  this.monitor=monitor;this.scenario=GLib.getenv('ORCHARD_SHORTCUT_CASE');this.started=false;
  const manager=global.workspace_manager;
  if(!this.setupBlocked){
   const wm=Main.wm;
   if(wm.blockWorkspaceUpdates)wm.blockWorkspaceUpdates();else wm._workspaceTracker.blockUpdates();
   this.setupBlocked=true;
  }
  while(manager.get_n_workspaces()<4)manager.append_new_workspace(false,global.display.get_current_time_roundtrip());
  this.identities=new Map(Array.from({length:manager.get_n_workspaces()},(_,i)=>[manager.get_workspace_by_index(i),i]));
  const first=['fullscreen-middle','remove-middle'].includes(this.scenario)?1:['fullscreen-last','remove-last','rotated','last-boundary'].includes(this.scenario)?3:0;
  this.first=first;this.next=first===0?3:0;
  const emptyRemoval=['remove-first','remove-middle','remove-last','remove-explicit','remove-keyboard','remove-final'].includes(this.scenario);
  const neighbor=first===0||first===3?1:0;
  this.fixtureMonitors=[monitor,monitor,1-monitor,1-monitor];
  this.fixtureWorkspaces=[emptyRemoval?neighbor:first,emptyRemoval?(first===3?1:3):this.next,first,2].map(i=>manager.get_workspace_by_index(i));
  if(this.scenario==='remove-fullscreen-last-origin'){
   this.fixtureMonitors[1]=1-monitor;this.fixtureWorkspaces[1]=manager.get_workspace_by_index(2);
  }
  Main.overview.hide();manager.get_workspace_by_index(first).activate(global.display.get_current_time_roundtrip());
  // Setup is not the operation under test. Do not relocate fixture windows
  // through retained animation snapshots while waiting for their placements.
  this.state().animation.cancel();
  for(const w of this.windows()){
   const i=Number(w.get_title().at(-1)),mi=this.fixtureMonitors[i],m=Main.layoutManager.monitors[mi];
   w.move_to_monitor(mi);w.change_workspace(this.fixtureWorkspaces[i]);
   w.move_resize_frame(false,m.x+60,m.y+60,400,300);
  }
  const pointerMonitor=this.scenario.startsWith('move-')||this.scenario.endsWith('-move')||this.scenario==='remove-explicit'?1-monitor:monitor;
  const m=Main.layoutManager.monitors[pointerMonitor];
  global.stage.context.get_backend().get_default_seat().warp_pointer(m.x+100,m.y+100);
  this.focusFixture=emptyRemoval?2:0;
  Main.activateWindow(this.windows().find(w=>w.get_title().endsWith(String(this.focusFixture))),global.display.get_current_time_roundtrip());
  global.stage.context.get_backend().get_default_seat().warp_pointer(m.x+100,m.y+100);
 }
 Prepare(){
  const state=this.state(),manager=global.workspace_manager;
  const local=this.scenario==='remove-fullscreen-last-origin'||this.scenario==='remove-final'?[this.first]:
   this.scenario.startsWith('fullscreen-')||this.scenario.startsWith('remove-')?[0,1,3]:this.scenario==='last-boundary'?[0,3]:[this.first,this.next];
  for(const [index,indices] of [[this.monitor,local],[1-this.monitor,[this.first,2]]]){
   const order=state.lifecycle.orderForMonitor(index);
   order.slots=indices.map(i=>order.slots.find(slot=>slot.workspace===manager.get_workspace_by_index(i))??
    {workspace:manager.get_workspace_by_index(i),owner:null,origin:null,retired:false});
  }
  this.otherSlot=state.lifecycle.orderForMonitor(1-this.monitor).slots[0];
  this.beforeSlots=[...state.lifecycle.orderForMonitor(this.monitor).slots];
  this.origin=this.beforeSlots.find(slot=>slot.workspace===manager.get_active_workspace());
  state.overview.syncLogicalOrders();
  if(this.setupBlocked){
   const wm=Main.wm;
   if(wm.unblockWorkspaceUpdates)wm.unblockWorkspaceUpdates();else wm._workspaceTracker.unblockUpdates();
   this.setupBlocked=false;
  }
  if(this.scenario==='overview-native'||this.scenario==='overview-move')Main.overview.show();
  if(this.scenario==='all-displays')state.settings.set_boolean('active-monitor-only',false);
  if(this.scenario==='extension-disabled')global.settings.set_strv('enabled-extensions',['orchard-activation-test@local']);
  this.total=0;this.rawSignals=0;this.lastWorkspace=manager.get_active_workspace();this.error=null;this.returned=false;
  const pointerMonitor=this.scenario.startsWith('move-')||this.scenario.endsWith('-move')||this.scenario==='remove-explicit'?1-this.monitor:this.monitor;
  const m=Main.layoutManager.monitors[pointerMonitor];
  global.stage.context.get_backend().get_default_seat().warp_pointer(m.x+100,m.y+100);
 }
 removalOrderPreserved(order){
  const expected=this.beforeSlots.filter(slot=>slot!==this.origin);
  const actual=order?.slots.filter(slot=>!this.scenario.startsWith('remove-fullscreen')||!slot.owner);
  return actual?.length===expected.length&&actual.every((slot,i)=>slot===expected[i]);
 }
 Activate(){
  this.started=true;
  try{
   this.sampleSource=GLib.timeout_add(GLib.PRIORITY_DEFAULT,20,()=>{
    this.samples.push(this.animationState());
    if(this.samples.length>=30){this.sampleSource=0;return GLib.SOURCE_REMOVE;}
    return GLib.SOURCE_CONTINUE;
   });
   GLib.timeout_add(GLib.PRIORITY_DEFAULT,80,()=>{this.Capture('during');return GLib.SOURCE_REMOVE;});
   if(this.scenario.startsWith('remove-fullscreen')){
    this.windows().find(w=>w.get_title().endsWith('0')).make_fullscreen();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{
     const state=this.state(),stack=state.lifecycle.stackForMonitor(this.monitor);
     state.lifecycle.activate(stack,this.origin);
     this.removalResult=state.lifecycle.removeWorkspace(this.monitor);
     return GLib.SOURCE_REMOVE;
    });
   }else if(this.scenario.startsWith('remove-')){
    if(this.scenario==='remove-keyboard')this.sendKey(111,[125,29]);
    else this.removalResult=this.state().lifecycle.removeWorkspace(this.monitor);
   }else if(this.scenario.startsWith('fullscreen-')){
    this.windows().find(w=>w.get_title().endsWith('0')).make_fullscreen();
   }else if(['interrupted-move','interrupted-gesture-move','overview-move','animations-disabled-move'].includes(this.scenario)){
    const controller=Main.wm._workspaceAnimation;
    if(this.scenario==='interrupted-gesture-move'){
     const tracker={confirmSwipe(){}};
     controller._switchWorkspaceBegin(tracker,1-this.monitor);
     controller._switchWorkspaceUpdate(tracker,.4);
     controller._switchWorkspaceEnd(tracker,250,1);
    }else controller.animateSwitch(0,3,Meta.MotionDirection.RIGHT,()=>{});
    GLib.timeout_add(GLib.PRIORITY_DEFAULT,60,()=>{
     this.interrupted=!!controller._switchData;
     if(this.scenario==='animations-disabled-move')new Gio.Settings({schema_id:'org.gnome.desktop.interface'}).set_boolean('enable-animations',false);
     const target=this.state().lifecycle.orderForMonitor(this.monitor).slots[1].workspace;
     Main.wm.actionMoveWindow(this.windows().find(w=>w.get_title().endsWith('0')),target);
     return GLib.SOURCE_REMOVE;
    });
   }else if(this.scenario==='gesture'){
    const controller=Main.wm._workspaceAnimation,tracker={confirmSwipe(){}};
    controller._switchWorkspaceBegin(tracker,this.monitor);
    controller._switchWorkspaceUpdate(tracker,.4);
    controller._switchWorkspaceEnd(tracker,150,1);
   }else if(this.scenario==='rapid-native'||this.scenario==='restack-arrival'){
    this.sendKey(106,[125,56]);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT,70,()=>{
     if(this.scenario==='restack-arrival'){
      const window=this.windows().find(w=>w.get_title().endsWith('3'));
      window.change_workspace(global.workspace_manager.get_active_workspace());window.raise();
     }else{
      const old=Main.wm._workspaceAnimation._switchData?.monitors;
      this.sendKey(105,[125,56]);
      GLib.timeout_add(GLib.PRIORITY_DEFAULT,30,()=>{
       const current=Main.wm._workspaceAnimation._switchData?.monitors;
       this.actorsReused=!!old&&!!current&&old.length===current.length&&old.every((group,i)=>group===current[i]);
       return GLib.SOURCE_REMOVE;
      });
     }
     return GLib.SOURCE_REMOVE;
    });
   }else{
    let key=106,modifiers=[125,56];
    if(this.scenario==='first-boundary'||this.scenario==='move-boundary')key=105;
    if(this.scenario==='native-number'||this.scenario==='move-number')key=3;
    if(this.scenario==='invalid-number')key=5;
    if(this.scenario==='native-last')key=107;
    if(this.scenario.startsWith('move'))modifiers.push(42);
    if(this.scenario==='orchard'){modifiers=[125,29];key=108;}
    this.sendKey(key,modifiers);
   }
   this.returned=true;
  }catch(error){this.error=String(error);}
 }
 sendKey(key,modifiers){
  this.keyboard??=global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
  let time=GLib.get_monotonic_time();
  for(const code of [...modifiers,key])this.keyboard.notify_key(time+=1000,code,Clutter.KeyState.PRESSED);
  for(const code of [key,...[...modifiers].reverse()])this.keyboard.notify_key(time+=1000,code,Clutter.KeyState.RELEASED);
 }
 animationState(){
  const controller=Main.wm._workspaceAnimation,data=controller._switchData;
  const window=this.windows().find(w=>w.get_title().endsWith('0'));
  const group=data?.monitors.find(item=>item.index===window?.get_monitor());
  const sticky=group?.get_children().filter(child=>child!==group._container)
   .flatMap(child=>child._windowRecords??[]);
  return {time:GLib.get_monotonic_time(),switching:!!data,selectedMonitor:this.state()?.animation.selectedMonitor,movingWindow:controller.movingWindow?.get_title(),
   movingWindowSticky:!!sticky?.some(record=>record.windowActor.meta_window===window&&record.clone.visible),
   groups:data?.monitors.map(item=>({index:item.index,progress:item.progress,
    workspaces:item._workspaceGroups.map(ws=>ws.workspace.index())}))??[]};
 }
 ExitFullscreen(){this.windows().find(w=>w.get_title().endsWith('0')).unmake_fullscreen();}
 Capture(label){this.capture(label).catch(error=>this.captureErrors.push(String(error)));}
 async capture(label){
  if(!/^[a-z-]+$/.test(label))throw new Error('Invalid capture label');
  const file=Gio.File.new_for_path(GLib.build_filenamev([GLib.getenv('ORCHARD_TEST_OUTPUT'),label+'.png']));
  const stream=file.replace(null,false,Gio.FileCreateFlags.NONE,null);
  try{
   const shooter=new Shell.Screenshot();
   const [content,scale]=await shooter.screenshot_stage_to_content();
   await Shell.Screenshot.composite_to_stream(content.get_texture(),0,0,-1,-1,scale,null,0,0,1,stream);
  }finally{stream.close(null);}
  this.captureComplete.push(label);
 }
 disable(){if(this.sampleSource)GLib.source_remove(this.sampleSource);global.workspace_manager.disconnect(this.signal);this.bus.unexport();}
}
