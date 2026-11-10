import { Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe, CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { bootstrapApplication, DomSanitizer } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

const icons: Record<string,string> = {
  sprout:'<path d="M7 20h10M12 20v-8m0 2C6 14 4 10 4 5c5 0 8 2 8 7m0 0c0-5 3-7 8-7 0 5-2 9-8 9"/>',
  building:'<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V3h6v4M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tractor:'<path d="M3 16h1m8 0h4m4-4V9h-7l-2-5H5v7m2-7v7m6-2v7"/><circle cx="8" cy="16" r="4"/><circle cx="19" cy="16" r="3"/>',
  box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5m-9 5v8M7.5 5.5l9 5"/>',
  orders:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6"/>',
  truck:'<path d="M1 5h14v12H1zM15 9h4l4 4v4h-8"/><circle cx="5.5" cy="18" r="2.5" fill="currentColor" stroke="none"/><circle cx="18.5" cy="18" r="2.5" fill="currentColor" stroke="none"/>',
  pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',right:'<path d="m9 6 6 6-6 6"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',diagonal:'<path d="M6 18 18 6M8 6h10v10"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wrench:'<path d="M21 4l-4 4-3-3 4-4a6 6 0 0 0-7 7L3 16a3 3 0 0 0 5 5l8-8a6 6 0 0 0 5-9z"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
@Component({
  selector: 'app-icon',
  host: {'[innerHTML]':'svg()','aria-hidden':'true'},
  template: ''
})
class IconComponent {
  readonly name = input.required<string>();
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly svg = computed(() => this.sanitizer.bypassSecurityTrustHtml(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+(icons[this.name()] ?? '')+'</svg>'
  ));
}

const routes = [
  {id:'overview', label:'Overview', icon:'grid'},
  {id:'vehicles', label:'Vehicle Sales', icon:'tractor'},
  {id:'parts', label:'Parts Distribution', icon:'box'},
  {id:'orders', label:'Orders', icon:'orders'},
  {id:'shipments', label:'Shipments', icon:'truck'},
  {id:'tracking', label:'Tracking', icon:'pin'}
] as const;
type Route = typeof routes[number]['id'];
type ItemType = 'vehicle' | 'part';
interface Item { id: string; name: string; category: string; price: number; stock: number; reorder: number; type: ItemType; }
interface ShipmentEvent { step: number; date: string; }
interface Order { id: string; tracking: string; customer: string; destination: string; itemId: string; quantity: number; status: number; eta: string; total: number; created: string; events: ShipmentEvent[]; }
interface Workspace { items: Item[]; orders: Order[]; }
type Modal = 'order-form' | 'item-form' | 'receipt' | 'detail' | 'search' | 'alerts' | '';
type SearchResult = { id: string; title: string; subtitle: string; type: ItemType | 'order' };

@Component({
  selector: 'app-root',
  imports: [DatePipe, CurrencyPipe, NgTemplateOutlet, FormsModule, IconComponent],
  templateUrl: './app.html',
  host: {'(window:hashchange)':'readRoute()','(document:keydown)':'handleKey($event)'}
})
class AppComponent {
  private readonly http = inject(HttpClient);
  readonly routes = routes;
  readonly stages = ['Preparing','In transit','Delivered'];
  readonly stageClasses = ['preparing','transit','delivered'];
  readonly events = ['Order received and shipment is being prepared','Shipment dispatched','Shipment delivered'];
  readonly page = signal<Route>('overview');
  readonly workspace = signal<Workspace>({items:[],orders:[]});
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly navOpen = signal(false);
  readonly query = signal('');
  readonly filter = signal('');
  readonly modal = signal<Modal>('');
  readonly selectedItem = signal<Item | null>(null);
  readonly selectedOrder = signal<Order | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly toast = signal('');
  readonly lookup = signal<Order | null>(null);
  readonly lookupError = signal('');
  readonly lookupBusy = signal(false);
  readonly searchQuery = signal('');
  trackingInput = '';
  itemForm: Item = this.newItem('part');
  receiptQty: number | null = 1;
  orderForm = {customer:'',destination:'',itemId:'',quantity:1 as number | null,eta:''};
  private toastTimer?: ReturnType<typeof setTimeout>;
  private lookupSequence = 0;

  readonly inventory = computed(() => this.workspace().items.filter(item => item.type === (this.page()==='vehicles'?'vehicle':'part')));
  readonly categories = computed(() => [...new Set(this.inventory().map(item => item.category))]);
  readonly available = computed(() => this.workspace().items.filter(item => item.stock>0));
  readonly lowStock = computed(() => this.workspace().items.filter(item => item.stock<=item.reorder));
  readonly currentLabel = computed(() => routes.find(route => route.id===this.page())?.label ?? 'Overview');
  readonly metrics = computed(() => {
    const {items,orders} = this.workspace();
    const vehicles = items.filter(item=>item.type==='vehicle');
    return [
      {route:'vehicles',icon:'tractor',value:vehicles.reduce((total,item)=>total+item.stock,0),label:'Vehicles in stock',note:'Across '+vehicles.length+' equipment models'},
      {route:'parts',icon:'box',value:items.filter(item=>item.type==='part').length,label:'Parts catalog',note:this.lowStock().filter(item=>item.type==='part').length+' parts at or below reorder point'},
      {route:'orders',icon:'orders',value:orders.filter(order=>order.status<2).length,label:'Open orders',note:'Preparing or in transit'},
      {route:'shipments',icon:'truck',value:orders.filter(order=>order.status===1).length,label:'Shipments in transit',note:'On the way to customers'}
    ];
  });
  readonly visibleItems = computed(() => this.inventory().filter(item=>
    (!this.filter() || item.category===this.filter()) && this.match(this.query(),item.name,item.category,item.id)));
  readonly visibleOrders = computed(() => this.workspace().orders.filter(order=>
    (!this.filter() || this.stages[order.status]===this.filter()) &&
    this.match(this.query(),order.id,order.tracking,order.customer,order.destination,this.itemName(order.itemId))));
  readonly searchResults = computed<SearchResult[]>(() => {
    const query = this.searchQuery().trim();
    if (!query) return [];
    const {items,orders} = this.workspace();
    return [
      ...items.filter(item=>this.match(query,item.name,item.id,item.category)).map(item=>({id:item.id,title:item.name,subtitle:item.id,type:item.type})),
      ...orders.filter(order=>this.match(query,order.customer,order.id,order.tracking)).map(order=>({id:order.id,title:order.customer,subtitle:order.id+' · '+order.tracking,type:'order' as const}))
    ].slice(0,12);
  });

  constructor() { this.readRoute(); void this.refresh(); }

  async refresh(): Promise<void> {
    this.loadError.set('');
    try { this.workspace.set(await firstValueFrom(this.http.get<Workspace>('/api/workspace'))); }
    catch (error) { this.loadError.set(this.message(error)); }
    finally { this.loading.set(false); }
  }

  readRoute(): void {
    const requested = location.hash.slice(1);
    const next = routes.find(route=>route.id===requested)?.id ?? 'overview';
    if (next!==this.page()) {
      this.page.set(next);
      this.query.set('');
      this.filter.set('');
    }
    this.navOpen.set(false);
  }

  navigate(page: Route): void {
    if (location.hash !== '#'+page) history.pushState(null,'','#'+page);
    this.readRoute();
  }

  itemName(id: string): string { return this.item(id)?.name ?? id; }
  item(id: string): Item | undefined { return this.workspace().items.find(item=>item.id===id); }
  stockLabel(item: Item): string { return item.stock===0?'Out of stock':item.stock<=item.reorder?item.stock+' left':item.stock+' in stock'; }
  stockClass(item: Item): string { return item.stock===0?'out':item.stock<=item.reorder?'low':'available'; }
  deliveryDate(order: Order): string { return order.status===2 ? order.events[order.events.length-1].date : order.eta; }
  match(query: string, ...values: string[]): boolean { return values.some(value=>value.toLowerCase().includes(query.trim().toLowerCase())); }
  newestEvents(order: Order): ShipmentEvent[] { return [...order.events].reverse(); }

  openModal(kind: Modal): void {
    this.error.set('');
    this.modal.set(kind);
    const dialog = document.querySelector('dialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  closeModal(): void {
    if (this.busy()) return;
    document.querySelector('dialog')?.close();
    this.modal.set('');
  }

  onDialogClose(): void { this.modal.set(''); }
  dismissFromBackdrop(event: MouseEvent): void { if(event.target===event.currentTarget) this.closeModal(); }

  openNewItem(type: ItemType): void { this.itemForm = this.newItem(type); this.openModal('item-form'); }
  openReceipt(item: Item): void { this.selectedItem.set(item); this.receiptQty=1; this.openModal('receipt'); }
  openDetail(order: Order): void { this.selectedOrder.set(order); this.openModal('detail'); }
  openSearch(): void {
    this.searchQuery.set('');
    this.openModal('search');
    setTimeout(()=>document.querySelector<HTMLInputElement>('#workspace-query')?.focus(),0);
  }
  openNewOrder(itemId?: string): void {
    const eta=new Date();
    eta.setDate(eta.getDate()+3);
    const localDate = new Date(eta.valueOf()-eta.getTimezoneOffset()*60000).toISOString().slice(0,10);
    this.orderForm={customer:'',destination:'',itemId:itemId ?? this.available()[0]?.id ?? '',quantity:1,eta:localDate};
    this.openModal('order-form');
  }

  private newItem(type: ItemType): Item { return {id:'',name:'',category:'',price:0,stock:0,reorder:0,type}; }
  private message(error: unknown): string {
    if(error instanceof HttpErrorResponse && typeof error.error?.message==='string') return error.error.message;
    return 'The server could not complete the request. Try again.';
  }
  private flash(text: string): void {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer=setTimeout(()=>this.toast.set(''),3600);
  }

  private async mutate<T>(url: string, body: unknown, onSuccess: (result: T) => void): Promise<void> {
    if(this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result=await firstValueFrom(this.http.post<T>(url,body));
      await this.refresh();
      this.busy.set(false);
      onSuccess(result);
    } catch(error) { this.error.set(this.message(error)); }
    finally { this.busy.set(false); }
  }
  addItem(): void {
    void this.mutate<Item>('/api/items',this.itemForm,item=>{
      this.closeModal();this.flash(item.name+' added to inventory.');
    });
  }
  receive(): void {
    const item=this.selectedItem();
    if(!item) return;
    void this.mutate<Item>('/api/items/'+encodeURIComponent(item.id)+'/receipts',{quantity:this.receiptQty},updated=>{
      this.closeModal();this.flash('Stock updated for '+updated.name+'.');
    });
  }
  createOrder(): void {
    void this.mutate<Order>('/api/orders',this.orderForm,order=>{
      this.closeModal();this.flash('Order '+order.id+' created · Tracking '+order.tracking);
    });
  }
  advance(): void {
    const order=this.selectedOrder();
    if(!order) return;
    void this.mutate<Order>('/api/shipments/'+encodeURIComponent(order.id)+'/advance',{expectedStatus:order.status},updated=>{
      this.selectedOrder.set(updated);
      if(this.lookup()?.id===updated.id) this.lookup.set(updated);
      this.flash(updated.tracking+' marked '+this.stages[updated.status].toLowerCase()+'.');
    });
  }
  async track(id = this.trackingInput): Promise<void> {
    const key=id.trim().toUpperCase();
    if(!key) { this.lookup.set(null);this.lookupError.set('Enter a tracking or order ID.');return; }
    const request=++this.lookupSequence;
    this.trackingInput=key;
    this.lookup.set(null);
    this.lookupError.set('');
    this.lookupBusy.set(true);
    try {
      const result=await firstValueFrom(this.http.get<Order>('/api/tracking/'+encodeURIComponent(key)));
      if(request===this.lookupSequence) this.lookup.set(result);
    } catch(error) { if(request===this.lookupSequence) this.lookupError.set(this.message(error)); }
    finally { if(request===this.lookupSequence) this.lookupBusy.set(false); }
  }
  openTracking(id: string): void { this.closeModal();this.navigate('tracking');void this.track(id); }
  chooseSearch(result: SearchResult): void {
    if(result.type==='order') {
      const order=this.workspace().orders.find(entry=>entry.id===result.id);
      if(order) this.openDetail(order);
    } else {
      this.closeModal();
      this.navigate(result.type==='vehicle'?'vehicles':'parts');
      this.filter.set('');
      this.query.set(result.id);
    }
  }
  handleKey(event: KeyboardEvent): void {
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {
      event.preventDefault(); if(!this.busy()) this.openSearch();
    }
    if(event.key==='Escape') this.navOpen.set(false);
  }
}

bootstrapApplication(AppComponent,{providers:[provideHttpClient()]}).catch(console.error);
