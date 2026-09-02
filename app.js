const { createClient } = supabase;
const sb = createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
let profile=null, employees=[];

const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=t=>t?new Date(t).toLocaleString():'—';

async function init(){
  const {data:{session}}=await sb.auth.getSession();
  if(session) await loadUser(session.user);
  sb.auth.onAuthStateChange((_e,s)=>{ if(s) loadUser(s.user); else showLogin(); });
}
async function loadUser(user){
  const {data,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error){console.error(error);return}
  profile=data; $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('roleLabel').textContent=profile.role==='admin'?'Administrator':`Employee: ${profile.full_name}`;
  if(profile.role==='admin'){ $('adminView').classList.remove('hidden'); $('employeeView').classList.add('hidden'); await loadAdmin(); }
  else { $('employeeView').classList.remove('hidden'); $('adminView').classList.add('hidden'); await loadEmployee(); }
}
function showLogin(){ $('appView').classList.add('hidden'); $('loginView').classList.remove('hidden'); }
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';const {error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error)$('loginError').textContent=error.message};
$('logoutBtn').onclick=()=>sb.auth.signOut();

async function loadAdmin(){
 const [{data:emps}, {data:att}, {data:settings}] = await Promise.all([
   sb.from('employees').select('*').order('full_name'),
   sb.from('attendance').select('*, employees(full_name,employee_code)').eq('attendance_date',today()).order('check_in',{ascending:false}),
   sb.from('office_settings').select('*').eq('id',1).maybeSingle()
 ]);
 employees=emps||[]; renderEmployees(); renderAttendance(att||[]);
 $('statEmployees').textContent=employees.filter(x=>x.active).length;
 $('statPresent').textContent=(att||[]).length;
 $('statOut').textContent=(att||[]).filter(x=>x.check_out).length;
 $('statLate').textContent=(att||[]).filter(x=>x.status==='late').length;
 if(settings){$('officeLat').value=settings.latitude;$('officeLng').value=settings.longitude;$('officeRadius').value=settings.radius_meters}
}
function renderEmployees(){
 const q=($('employeeSearch').value||'').toLowerCase();
 $('employeeTable').innerHTML=employees.filter(x=>(x.full_name+' '+x.employee_code+' '+(x.email||'')).toLowerCase().includes(q)).map(x=>`<tr><td>${esc(x.employee_code)}</td><td>${esc(x.full_name)}</td><td>${esc(x.email)}</td><td>${esc(x.department||'')}</td><td>${x.active?'Active':'Inactive'}</td></tr>`).join('');
}
function renderAttendance(rows){
 $('attendanceTable').innerHTML=rows.map(x=>`<tr><td>${esc(x.employees?.full_name||'')}</td><td>${x.attendance_date}</td><td>${fmt(x.check_in)}</td><td>${fmt(x.check_out)}</td><td>${x.latitude&&x.longitude?`${Number(x.latitude).toFixed(5)}, ${Number(x.longitude).toFixed(5)}`:'—'}</td></tr>`).join('');
}
$('employeeSearch').oninput=renderEmployees;
$('refreshAdmin').onclick=loadAdmin;

$('settingsForm').onsubmit=async e=>{
 e.preventDefault();const row={id:1,latitude:Number($('officeLat').value),longitude:Number($('officeLng').value),radius_meters:Number($('officeRadius').value)};
 const {error}=await sb.from('office_settings').upsert(row);$('settingsMsg').textContent=error?error.message:'Office GPS settings saved.';
};

$('employeeForm').onsubmit=async e=>{
 e.preventDefault();$('empMsg').textContent='Creating...';
 const {data,error}=await sb.functions.invoke('create-employee',{body:{
   email:$('empEmail').value,password:$('empPassword').value,full_name:$('empName').value,
   employee_code:$('empId').value,department:$('empDept').value,designation:$('empDesignation').value
 }});
 $('empMsg').textContent=error?error.message:(data?.message||'Employee created.');
 if(!error){e.target.reset();loadAdmin()}
};

async function loadEmployee(){
 $('employeeWelcome').textContent=`Welcome, ${profile.full_name}`;
 const {data}=await sb.from('attendance').select('*').eq('employee_id',profile.id).order('attendance_date',{ascending:false}).limit(50);
 renderMyAttendance(data||[]);
 const rec=(data||[]).find(x=>x.attendance_date===today());
 $('todayStatus').textContent=rec?(rec.check_out?`Checked out at ${fmt(rec.check_out)}`:`Checked in at ${fmt(rec.check_in)}`):'Not checked in today';
 $('checkInBtn').disabled=!!rec; $('checkOutBtn').disabled=!rec||!!rec.check_out;
}
function renderMyAttendance(rows){$('myAttendanceTable').innerHTML=rows.map(x=>`<tr><td>${x.attendance_date}</td><td>${fmt(x.check_in)}</td><td>${fmt(x.check_out)}</td><td>${x.latitude&&x.longitude?'GPS recorded':'—'}</td></tr>`).join('')}

function distanceMeters(lat1,lon1,lat2,lon2){const R=6371000,p=Math.PI/180,a=.5-Math.cos((lat2-lat1)*p)/2+Math.cos(lat1*p)*Math.cos(lat2*p)*(1-Math.cos((lon2-lon1)*p))/2;return 2*R*Math.asin(Math.sqrt(a))}
async function gps(){
 $('gpsMsg').textContent='Requesting GPS location...';
 if(!navigator.geolocation) throw Error('GPS is not supported by this device/browser.');
 return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,e=>reject(Error(e.message)),{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
}
async function attendanceAction(type){
 try{
   const pos=await gps();const lat=pos.coords.latitude,lon=pos.coords.longitude;
   const {data:s}=await sb.from('office_settings').select('*').eq('id',1).single();
   if(!s) throw Error('Office GPS settings have not been configured by the administrator.');
   const d=distanceMeters(lat,lon,s.latitude,s.longitude);
   if(d>s.radius_meters) throw Error(`You are about ${Math.round(d)} m from the office. Allowed radius is ${s.radius_meters} m.`);
   const now=new Date().toISOString();
   if(type==='in'){
     const {error}=await sb.from('attendance').insert({employee_id:profile.id,attendance_date:today(),check_in:now,latitude:lat,longitude:lon,check_in_accuracy:pos.coords.accuracy});
     if(error)throw error;
   }else{
     const {error}=await sb.from('attendance').update({check_out:now,check_out_latitude:lat,check_out_longitude:lon,check_out_accuracy:pos.coords.accuracy}).eq('employee_id',profile.id).eq('attendance_date',today()).is('check_out',null);
     if(error)throw error;
   }
   $('gpsMsg').textContent='Attendance recorded successfully.'; await loadEmployee();
 }catch(e){$('gpsMsg').textContent=e.message||'Could not record attendance.'}
}
$('checkInBtn').onclick=()=>attendanceAction('in'); $('checkOutBtn').onclick=()=>attendanceAction('out');

$('exportBtn').onclick=async()=>{
 const {data}=await sb.from('attendance').select('attendance_date,check_in,check_out,latitude,longitude,employees(full_name,employee_code)').eq('attendance_date',today());
 const lines=[['Employee ID','Employee Name','Date','Check In','Check Out','Latitude','Longitude'],...(data||[]).map(x=>[x.employees?.employee_code,x.employees?.full_name,x.attendance_date,x.check_in,x.check_out,x.latitude,x.longitude])];
 const csv=lines.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`attendance-${today()}.csv`;a.click();
};
init();
