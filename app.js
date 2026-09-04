const { createClient } = supabase;

const sb = createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

let profile = null;
let employees = [];

const $ = id => document.getElementById(id);

const today = () => new Date().toISOString().slice(0, 10);

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));

const fmt = t => t ? new Date(t).toLocaleString() : '—';


// =========================
// START APP
// =========================

async function init() {
  try {
    const {
      data: { session },
      error
    } = await sb.auth.getSession();

    if (error) {
      console.error(error);
      $('loginError').textContent = error.message;
      return;
    }

    if (session) {
      await loadUser(session.user);
    } else {
      showLogin();
    }

    sb.auth.onAuthStateChange((_event, session) => {
      if (session) {
        loadUser(session.user);
      } else {
        showLogin();
      }
    });

  } catch (e) {
    console.error(e);
    $('loginError').textContent =
      e.message || 'Unable to connect to Supabase.';
  }
}


// =========================
// LOGIN
// =========================

async function loadUser(user) {
  try {
    const {
      data,
      error
    } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error(error);
      $('loginError').textContent = error.message;
      return;
    }

    profile = data;

    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');

    $('roleLabel').textContent =
      profile.role === 'admin'
        ? 'Administrator'
        : `Employee: ${profile.full_name || ''}`;

    if (profile.role === 'admin') {

      $('adminView').classList.remove('hidden');
      $('employeeView').classList.add('hidden');

      await loadAdmin();

    } else {

      $('employeeView').classList.remove('hidden');
      $('adminView').classList.add('hidden');

      await loadEmployee();
    }

  } catch (e) {
    console.error(e);
  }
}


function showLogin() {
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}


$('loginForm').onsubmit = async e => {

  e.preventDefault();

  $('loginError').textContent = 'Signing in...';

  try {

    const {
      error
    } = await sb.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value
    });

    if (error) {
      $('loginError').textContent = error.message;
    }

  } catch (e) {

    console.error(e);

    $('loginError').textContent =
      'Connection failed. Please check the Supabase configuration.';
  }
};


$('logoutBtn').onclick = async () => {
  await sb.auth.signOut();
};


// =========================
// ADMIN DASHBOARD
// =========================

async function loadAdmin() {

  try {

    const [
      employeesResult,
      attendanceResult,
      settingsResult
    ] = await Promise.all([

      sb
        .from('employees')
        .select('*')
        .order('name'),

      sb
        .from('attendance')
        .select('*, employees(name,employee_code)')
        .eq('attendance_date', today())
        .order('check_in', { ascending: false }),

      sb
        .from('office_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
    ]);


    if (employeesResult.error) {
      console.error(employeesResult.error);
    }

    if (attendanceResult.error) {
      console.error(attendanceResult.error);
    }

    if (settingsResult.error) {
      console.error(settingsResult.error);
    }


    employees = employeesResult.data || [];

    const att = attendanceResult.data || [];

    renderEmployees();
    renderAttendance(att);


    $('statEmployees').textContent =
      employees.filter(x => x.active).length;

    $('statPresent').textContent =
      att.length;

    $('statOut').textContent =
      att.filter(x => x.check_out).length;

    $('statLate').textContent =
      att.filter(x => x.status === 'late').length;


    const settings = settingsResult.data;

    if (settings) {

      $('officeLat').value =
        settings.latitude ?? '';

      $('officeLng').value =
        settings.longitude ?? '';

      $('officeRadius').value =
        settings.radius_m ?? 100;
    }

  } catch (e) {

    console.error(e);
  }
}


// =========================
// EMPLOYEE LIST
// =========================

function renderEmployees() {

  const q =
    ($('employeeSearch').value || '').toLowerCase();

  $('employeeTable').innerHTML =

    employees

      .filter(x =>
        (
          x.name +
          ' ' +
          x.employee_code +
          ' ' +
          (x.email || '')
        )
        .toLowerCase()
        .includes(q)
      )

      .map(x => `
        <tr>
          <td>${esc(x.employee_code)}</td>
          <td>${esc(x.name)}</td>
          <td>${esc(x.email)}</td>
          <td>${esc(x.department || '')}</td>
          <td>${x.active ? 'Active' : 'Inactive'}</td>
        </tr>
      `)

      .join('');
}


function renderAttendance(rows) {

  $('attendanceTable').innerHTML =

    rows.map(x => `

      <tr>

        <td>${esc(x.employees?.name || '')}</td>

        <td>${x.attendance_date}</td>

        <td>${fmt(x.check_in)}</td>

        <td>${fmt(x.check_out)}</td>

        <td>
          ${
            x.check_in_lat != null &&
            x.check_in_lng != null
              ? `${Number(x.check_in_lat).toFixed(5)},
                 ${Number(x.check_in_lng).toFixed(5)}`
              : '—'
          }
        </td>

      </tr>

    `).join('');
}


$('employeeSearch').oninput = renderEmployees;

$('refreshAdmin').onclick = loadAdmin;


// =========================
// OFFICE GPS SETTINGS
// =========================

$('settingsForm').onsubmit = async e => {

  e.preventDefault();

  $('settingsMsg').textContent = 'Saving...';

  try {

    const row = {
      id: 1,
      latitude: Number($('officeLat').value),
      longitude: Number($('officeLng').value),
      radius_m: Number($('officeRadius').value)
    };


    const { error } = await sb
      .from('office_settings')
      .upsert(row);


    if (error) {

      console.error(error);

      $('settingsMsg').textContent =
        error.message;

      return;
    }


    $('settingsMsg').textContent =
      'Office GPS settings saved.';

  } catch (e) {

    console.error(e);

    $('settingsMsg').textContent =
      e.message || 'Could not save settings.';
  }
};


// =========================
// CREATE EMPLOYEE
// =========================

$('employeeForm').onsubmit = async e => {

  e.preventDefault();

  $('empMsg').textContent =
    'Creating employee...';

  try {

    const {
      data,
      error
    } = await sb.functions.invoke(
      'create-employee',
      {
        body: {

          email:
            $('empEmail').value.trim(),

          password:
            $('empPassword').value,

          name:
            $('empName').value.trim(),

          employee_code:
            $('empId').value.trim(),

          department:
            $('empDept').value.trim(),

          phone:
            $('empPhone')
              ? $('empPhone').value.trim()
              : ''
        }
      }
    );


    if (error) {

      console.error(error);

      $('empMsg').textContent =
        error.message;

      return;
    }


    $('empMsg').textContent =
      data?.message ||
      'Employee created successfully.';


    e.target.reset();

    await loadAdmin();

  } catch (e) {

    console.error(e);

    $('empMsg').textContent =
      e.message ||
      'Could not create employee.';
  }
};


// =========================
// FIND EMPLOYEE RECORD
// =========================

async function getEmployeeRecord() {

  const {
    data,
    error
  } = await sb
    .from('employees')
    .select('*')
    .eq('user_id', profile.id)
    .single();


  if (error) {

    console.error(error);

    throw Error(
      'Employee record was not found.'
    );
  }


  return data;
}


// =========================
// EMPLOYEE DASHBOARD
// =========================

async function loadEmployee() {

  try {

    const employee =
      await getEmployeeRecord();


    $('employeeWelcome').textContent =
      `Welcome, ${employee.name}`;


    const {
      data,
      error
    } = await sb
      .from('attendance')
      .select('*')
      .eq('employee_id', employee.id)
      .order('attendance_date', {
        ascending: false
      })
      .limit(50);


    if (error) {

      console.error(error);

      $('todayStatus').textContent =
        error.message;

      return;
    }


    renderMyAttendance(data || []);


    const rec =
      (data || [])
        .find(x =>
          x.attendance_date === today()
        );


    $('todayStatus').textContent =

      rec

        ? (
            rec.check_out
              ? `Checked out at ${fmt(rec.check_out)}`
              : `Checked in at ${fmt(rec.check_in)}`
          )

        : 'Not checked in today';


    $('checkInBtn').disabled =
      !!rec;

    $('checkOutBtn').disabled =
      !rec || !!rec.check_out;


  } catch (e) {

    console.error(e);

    $('todayStatus').textContent =
      e.message ||
      'Could not load attendance.';
  }
}


function renderMyAttendance(rows) {

  $('myAttendanceTable').innerHTML =

    rows.map(x => `

      <tr>

        <td>${x.attendance_date}</td>

        <td>${fmt(x.check_in)}</td>

        <td>${fmt(x.check_out)}</td>

        <td>
          ${
            x.check_in_lat != null &&
            x.check_in_lng != null
              ? 'GPS recorded'
              : '—'
          }
        </td>

      </tr>

    `).join('');
}


// =========================
// GPS DISTANCE
// =========================

function distanceMeters(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371000;

  const p = Math.PI / 180;

  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    Math.cos(lat1 * p) *
    Math.cos(lat2 * p) *
    (
      1 -
      Math.cos((lon2 - lon1) * p)
    ) / 2;

  return (
    2 *
    R *
    Math.asin(Math.sqrt(a))
  );
}


// =========================
// GET GPS
// =========================

async function gps() {

  $('gpsMsg').textContent =
    'Requesting GPS location...';


  if (!navigator.geolocation) {

    throw Error(
      'GPS is not supported by this device/browser.'
    );
  }


  return new Promise(
    (resolve, reject) => {

      navigator.geolocation.getCurrentPosition(

        resolve,

        e =>
          reject(
            Error(
              e.message ||
              'Unable to get GPS location.'
            )
          ),

        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );

    }
  );
}


// =========================
// CHECK IN / CHECK OUT
// =========================

async function attendanceAction(type) {

  try {

    const pos = await gps();


    const lat =
      pos.coords.latitude;

    const lon =
      pos.coords.longitude;


    const {
      data: settings,
      error: settingsError
    } = await sb
      .from('office_settings')
      .select('*')
      .eq('id', 1)
      .single();


    if (settingsError) {
      throw settingsError;
    }


    if (
      settings.latitude == null ||
      settings.longitude == null
    ) {

      throw Error(
        'Office GPS location has not been configured.'
      );
    }


    const d =
      distanceMeters(
        lat,
        lon,
        settings.latitude,
        settings.longitude
      );


    if (d > settings.radius_m) {

      throw Error(
        `You are about ${Math.round(d)} m from the office. ` +
        `Allowed radius is ${settings.radius_m} m.`
      );
    }


    const employee =
      await getEmployeeRecord();


    const now =
      new Date().toISOString();


    if (type === 'in') {

      const {
        error
      } = await sb
        .from('attendance')
        .insert({

          employee_id:
            employee.id,

          attendance_date:
            today(),

          check_in:
            now,

          check_in_lat:
            lat,

          check_in_lng:
            lon
        });


      if (error) {
        throw error;
      }

    } else {

      const {
        error
      } = await sb
        .from('attendance')
        .update({

          check_out:
            now,

          check_out_lat:
            lat,

          check_out_lng:
            lon

        })
        .eq(
          'employee_id',
          employee.id
        )
        .eq(
          'attendance_date',
          today()
        )
        .is(
          'check_out',
          null
        );


      if (error) {
        throw error;
      }
    }


    $('gpsMsg').textContent =
      'Attendance recorded successfully.';


    await loadEmployee();


  } catch (e) {

    console.error(e);

    $('gpsMsg').textContent =
      e.message ||
      'Could not record attendance.';
  }
}


$('checkInBtn').onclick =
  () => attendanceAction('in');


$('checkOutBtn').onclick =
  () => attendanceAction('out');


// =========================
// EXPORT TODAY ATTENDANCE
// =========================

$('exportBtn').onclick = async () => {

  try {

    const {
      data,
      error
    } = await sb
      .from('attendance')
      .select(
        'attendance_date,check_in,check_out,' +
        'check_in_lat,check_in_lng,' +
        'employees(name,employee_code)'
      )
      .eq(
        'attendance_date',
        today()
      );


    if (error) {
      throw error;
    }


    const lines = [

      [
        'Employee ID',
        'Employee Name',
        'Date',
        'Check In',
        'Check Out',
        'Latitude',
        'Longitude'
      ],

      ...(data || []).map(x => [

        x.employees?.employee_code,

        x.employees?.name,

        x.attendance_date,

        x.check_in,

        x.check_out,

        x.check_in_lat,

        x.check_in_lng

      ])

    ];


    const csv =

      lines

        .map(row =>
          row
            .map(v =>
              `"${String(v ?? '')
                .replaceAll('"', '""')}"`
            )
            .join(',')
        )

        .join('\n');


    const a =
      document.createElement('a');


    a.href =
      URL.createObjectURL(
        new Blob(
          [csv],
          { type: 'text/csv' }
        )
      );


    a.download =
      `attendance-${today()}.csv`;


    a.click();

  } catch (e) {

    console.error(e);

    alert(
      e.message ||
      'Could not export attendance.'
    );
  }
};


// =========================
// RUN
// =========================

init();
