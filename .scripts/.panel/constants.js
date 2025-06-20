// =======================
// CONSTANTS
// =======================

const { DateTime } = luxon;

const LOCATION_UUID = "9e92e73f-4f4a-4252-8d56-ebd8e74772f1";
const TIMEZONE = "America/Chicago";


let countdownInterval = null;

// AUTOMATIONS
const CAMERA_CONFIG = [
    { id: "light-loft-back-room", position: { vertical: 140, horizontal: 180 }, label: "floor" },
    { id: "light-loft-back-room", position: { vertical: 120, horizontal: 180 }, label: "wall" },
    { id: "light-loft-back-room", position: { vertical: 120, horizontal: 90 }, label: "left" },
    { id: "light-loft-back-room", position: { vertical: 120, horizontal: 270 }, label: "right" },
    { id: "light-loft-west", position: { vertical: 110, horizontal: 140 }, label: "room" },
    { id: "light-loft-west", position: { vertical: 135, horizontal: 140 }, label: "floor" },
    { id: "light-loft-east", position: { vertical: 120, horizontal: 230 }, label: "door" },
    { id: "light-loft-east", position: { vertical: 100, horizontal: 150 }, label: "room" },
    { id: "light-loft-east", position: { vertical: 155, horizontal: 185 }, label: "tablet" }
]
  
const LOCAL_API_BASE = "https://100.106.124.36:5000"; 
const SNAPSHOT_MAKE_WEBHOOK_URL = "https://hook.us1.make.com/ls3kf6o5j8mml61s13v89x9cyorf5mos";
const HA_WEBHOOK_PREBOOKING_URL = "http://homeassistant:8123/api/webhook/pre_booking_setup";
  