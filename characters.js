// characters.js — twelve story characters who live in the city.
//
// They aren't quest-givers waiting for the player. Each one has a job, a
// history, money trouble or a secret, a way of talking, and a day of their
// own: they walk (along the road graph) between the places their schedule
// sends them, and do their thing when they get there — sell hot dogs, busk,
// paint, argue on the phone, feed pigeons, sleep on the embankment.
//
// Every reply is assembled from their live state, the same way an LLM prompt
// would be: time of day, where they are and what they're doing, mood and
// needs (hungry, tired, broke), what they've just seen (gunshots, a crash),
// and what they remember about the player (met before? threatened them?
// shot them? did them a favour? what their friends told them). Replies come
// back as { dialogue, emotion, action, att } and the action is acted out:
// they walk off, flee, shove you, ring someone, or carry on.
//
// They only know their own world: no player name, no plot, rumours that are
// sometimes wrong, and "no idea" when they don't know. Memory, money and
// favours are saved in localStorage so they hold grudges between sessions.
import { scene, camera, engine, canvas, hex, litMat, addSolidR, clamp, terrainH, state as world } from "./engine.js";
import { edges, nodes, pathAt, landmarks, PARIS, SHORE_X } from "./roads.js";
import { LON_CORE } from "./london.js";
import { POND } from "./nature.js";
import { spawnCharacter, placePed, fleePed, pedHooks } from "./people.js";

const R = Math.random;
const pick = (a) => a[Math.floor(R() * a.length)];
const MB = BABYLON.MeshBuilder;
const V = BABYLON.Vector3;

// ================================================================ the cast
// schedule: [hour, spot, pose, what they're doing]. "home" = off the streets.
// Poses "run"/"jog" mean they roam the streets at speed instead of standing.
const CAST = [
  {
    id: "mac", name: "Marco “Mac” Delgado", short: "Mac", age: 34, role: "Tow-truck driver", offset: -2.5,
    look: { shirt: "#24476b", skin: "#c08462", hair: "#1d140e", pants: "#2b2b2b", beard: true }, hat: ["cap", "#b8261f"],
    persona: { brave: 0.8, temper: 0.75, warmth: 0.35 }, walkSpeed: 1.5,
    addr: { hostile: "pal", neutral: "buddy", friend: "man" },
    quirk: { pre: ["Look, ", "Man, ", "Yeah, ", "Listen— "], post: [", y'know?", ", whatever.", ". Damn.", ""] },
    schedule: [[0, "home"], [6, "times", "eat", "eating breakfast by the plaza"], [8, "rb", "lean", "waiting on a tow call"], [13, "midE", "eat", "on his lunch break"], [14, "rb", "phone", "arguing with dispatch"], [19, "broadway", "lean", "watching the street racers"], [23, "home"]],
    greet: {
      first: ["What? I'm working here.", "You need a tow or you just staring?"],
      again: ["You again.", "Back already? Huh."],
      friend: ["Hey, it's you. Pull up some curb, I'm on break. Kind of."],
      hostile: ["Keep walking, {you}.", "Nope. Not today."],
      busy: ["Can't talk long, dispatch could call any second."],
    },
    small: {
      lean: ["Sal's got me parked here like a lawn ornament. Waiting on a call.", "Slow night. Slow nights don't pay."],
      phone: ["Dispatch says two cars on Broadway, then says never mind. Every. Day."],
      eat: ["Gas-station bagel. Living the dream."],
      any: ["Same old. Tow, wait, tow, wait."],
    },
    rumors: [
      { t: "They race down Broadway after midnight. Cops never show. Weird, right?", need: -1 },
      { t: "That big wheel in London? Heard it stops dead at 3am. Ghost in a pod or something. ...Probably nothing.", need: 0 },
      { t: "Sal's in deep with somebody. Trucks keep getting 'repossessed' off our own lot.", need: 1 },
      { t: "Vinnie Sour runs half the loans in Midtown and stands next to the hot-dog cart like he's waiting for a bus. Don't quote me.", need: 3 },
    ],
    bio: [
      { t: "Mac. Marco Delgado if you're my mother. I tow cars for Sal's.", need: -2 },
      { t: "Grew up down by the docks. Quit school at sixteen. Been driving something ever since.", need: 1 },
      { t: "My sister's kid, Lucia — she's eight, smart as hell. I'm gonna get her into a real school.", need: 3 },
      { t: "...I owe four grand to the wrong guy. Don't make that face.", need: 5 },
    ],
    deflect: ["Why do you care?", "That's my business, buddy."],
    opinions: {
      vinnie: "Vinnie? Smiles like a shark at a pool party. Stay away from him.",
      bernie: "Bernie's alright. Talks too much. Good dogs though.",
      sofia: "Sofia patched me up once. Didn't even ask how I hurt my hand. Good people.",
      kenji: "Kenji cuts in front of my truck like he's got nine lives.",
      grant: "Suit guy. Had me tow his rival's cars once. Paid cash. I didn't ask.",
    },
    needs: { hungry: ["Haven't eaten since this morning. Running on coffee and spite."], tired: ["Up since five. My eyes feel like sandpaper."], broke: ["Payday's Friday. Friday's a long way off."] },
    gift: { takes: true, att: 2, accept: ["...Twenty bucks? Huh. Thanks. Don't make it weird."] },
    threat: { action: "attack", lines: ["You wanna go? Let's go.", "Wrong guy, wrong day."] },
    bye: { hostile: ["Yeah, beat it."], neutral: ["Later."], friend: ["Take it easy, man."] },
    barks: { work: ["Come on, ring...", "Sal, you cheap..."], friendly: ["Hey! ...Nah, just saying hi."], hostile: ["Don't even."], night: ["Racers'll be out soon."] },
    friends: ["sofia", "bernie"],
    favor: {
      need: 1, target: "vinnie",
      ask: "You heading by Times plaza? Tell Vinnie — guy in the nice coat — I'll have it Friday. Just... say Friday.",
      remind: "You tell Vinnie yet? Friday. That's all you gotta say.",
      thanks: "He said that? ...Yeah. Okay. Here, for your trouble.", reward: { cash: 40, att: 2 },
    },
    receives: {
      vinnie: { say: "He said WHAT about my sister? ...You tell that snake— no. You don't carry his messages. Get away from me.", emo: "angry", att: -2 },
      sofia: { say: "Lucia asked about me? ...I'll call my sister. Tonight. Thanks. Really.", emo: "sad", att: 3 },
    },
    vs: { vinnie: "Friday, Vinnie. I said Friday.", kenji: "Watch the truck, Kenji!" },
  },
  {
    id: "edith", name: "Edith Pemberton", short: "Mrs. Pemberton", age: 71, role: "Retired schoolteacher", offset: -3,
    look: { shirt: "#6b4a7a", skin: "#e0b08c", hair: "#d0d0d0", pants: "#3d3d4a" }, hat: ["sunhat", "#5a3f6e"], glasses: true,
    persona: { brave: 0.55, temper: 0.4, warmth: 0.5, elderly: true }, walkSpeed: 0.85,
    addr: { hostile: "young man", neutral: "dear", friend: "my dear" },
    quirk: { pre: ["Well, ", "Hm. ", "Goodness, ", "I'll have you know, "], post: [", dear.", "", ". Honestly."] },
    schedule: [[0, "home"], [7, "square", "feed", "feeding the pigeons"], [10, "clock", "read", "reading by the clock tower"], [13, "highSt", "stand", "doing her shopping"], [15, "square", "read", "writing in her notebook"], [19, "home"]],
    greet: {
      first: ["Yes? Can I help you, or are you simply loitering?", "Mind the pigeons, dear. They were here first."],
      again: ["Oh. It's you again."],
      friend: ["There you are! I was beginning to think you'd been arrested."],
      hostile: ["I've nothing to say to you. Shoo."],
      busy: ["Not now, I've only just found my place in this chapter."],
    },
    small: {
      feed: ["Arthur used to feed them. Now I do. Somebody has to."],
      read: ["It's a murder mystery. The butler did it — I could tell by page four."],
      stand: ["Twelve pence more for teabags. Twelve! It's daylight robbery."],
      any: ["One keeps busy, dear. The alternative is daytime television."],
    },
    rumors: [
      { t: "That property man, Holloway, has been measuring our square with a little wheel. One doesn't measure what one isn't planning to destroy.", need: -1 },
      { t: "I'm told the clock tower runs four minutes slow. I'm told wrong — it's three.", need: 0 },
      { t: "The busker boy plays far too loudly. Quite well, though. Don't you dare tell him.", need: 0 },
      { t: "Old Tom on the embankment was a merchant sailor. Decorated, you know. People walk past him like he's furniture.", need: 2 },
      { t: "Between us, dear: somebody has been leaving envelopes under the bench at the square. Thick ones.", need: 4 },
    ],
    bio: [
      { t: "Edith Pemberton. Mrs. I taught English for thirty-one years, so do mind your grammar.", need: -2 },
      { t: "My husband Arthur passed three years ago. His heart. He'd have liked you — he liked strays.", need: 2 },
      { t: "I write crime novels. Under a pen name. Seven of them. My neighbours haven't the faintest idea.", need: 4 },
      { t: "The latest has a property developer who comes to a very sticky end. Pure coincidence.", need: 6 },
    ],
    deflect: ["I hardly think that's any of your business.", "Manners, dear. We've only just met."],
    opinions: {
      jay: "The busker? Loud boy. Talented. Needs a haircut.",
      priya: "Ms. Shah is the only person at the council with a spine.",
      grant: "Holloway is a vulture in a nice suit.",
      tom: "Thomas is a gentleman. Fallen on hard times, but a gentleman.",
    },
    needs: { hungry: ["I've had nothing but a biscuit since breakfast."], tired: ["My hip is complaining. It does that."], broke: ["My pension stretches about as far as my patience."] },
    gift: { takes: false, att: 1, refuse: ["Put that away! I'm not a charity case. Give it to Thomas on the embankment if you must."] },
    threat: { action: "phone", lines: ["I beg your pardon! I'm ringing the police this instant.", "How dare you. I taught boys like you. I'm calling someone."] },
    bye: { hostile: ["Good riddance."], neutral: ["Good day."], friend: ["Mind how you go, dear."] },
    barks: { work: ["Shoo! Not you, the pigeon.", "Three minutes slow, that clock."], friendly: ["Hello, dear!"], hostile: ["Hmph."], night: [] },
    friends: ["tom", "priya"],
    favor: {
      need: 1, target: "jay",
      ask: "Would you tell the busker boy on the high street that his music is... acceptable? Don't you dare say I said 'lovely'.",
      remind: "Have you told that boy yet?",
      thanks: "He said thank you? Well. Manners after all. Here — buy yourself something sensible.", reward: { cash: 20, att: 2 },
    },
    receives: {},
    vs: { jay: "Not so loud, young man!", grant: "Still measuring, Mr. Holloway?" },
  },
  {
    id: "jay", name: "Jamal “Jay” Okafor", short: "Jay", age: 22, role: "Busker", offset: 2,
    look: { shirt: "#d9a521", skin: "#5c3a26", hair: "#111111", pants: "#2b3a55" }, hat: ["beanie", "#1d1d1d"], guitar: true,
    persona: { brave: 0.5, temper: 0.45, warmth: 0.7 }, walkSpeed: 1.45,
    addr: { hostile: "bruv", neutral: "fam", friend: "my g" },
    quirk: { pre: ["Yo, ", "Bruv, ", "Nah but ", "Listen, "], post: [", innit.", ", trust.", ", fam.", ""] },
    schedule: [[0, "londonPub", "busk", "busking outside the Red Lion"], [2, "home"], [11, "highSt", "busk", "busking on the high street"], [16, "bridge", "busk", "playing on the bridge"], [20, "londonPub", "busk", "busking outside the Red Lion"]],
    greet: {
      first: ["You gonna drop a coin or just vibe?", "Yo. Requests are a fiver. Joking. Unless?"],
      again: ["Ayy, you're back."],
      friend: ["My g! Stay, I'm trying a new one."],
      hostile: ["Allow it, man. Go on."],
      busy: ["Hold up, I'm mid-song."],
    },
    small: {
      busk: ["Wrote this one on the night bus. Bus had no heating. Song's got feeling though.", "Street's dead today. Even the pigeons ain't tipping."],
      any: ["Just trying to get heard, you know?"],
    },
    rumors: [
      { t: "Man in the suit, Holloway, offered me fifty quid to busk somewhere else. Somewhere else was the river, apparently.", need: -1 },
      { t: "The Red Lion landlord waters the beer. Everyone knows. Everyone drinks it anyway.", need: 0 },
      { t: "Heard a record-label scout walks the high street on Thursdays. Probably a myth. Probably.", need: 1 },
      { t: "There's a girl who sits by the pub every night, drawing. Never says nothing. Always tips though.", need: 2 },
    ],
    bio: [
      { t: "Jay. Jamal Okafor on the posters, if I ever get posters.", need: -2 },
      { t: "Mum wanted me to do accounting. I can count — I count every coin in this case.", need: 1 },
      { t: "Rent's two weeks late. Mrs. Finch keeps leaving notes. Polite notes. Scary notes.", need: 3 },
      { t: "I put a song online last month. Twelve listens. Eleven are me. One's from someone called 'amelie_draws'.", need: 5 },
    ],
    deflect: ["Ha, nah, you ain't getting my life story for free.", "Bit personal, fam."],
    opinions: {
      amelie: "Drawing girl? ...She's alright. Why, she say something?",
      edith: "Pigeon lady tuts at me every day. Every day! I think she likes me.",
      grant: "Suit man wants this whole street gone. Wants me gone too.",
      tom: "Old Tom taught me a sea shanty. Absolute banger, actually.",
    },
    needs: { hungry: ["I'd fight a seagull for a chip right now."], tired: ["Played till 2am. My fingers have retired."], broke: ["Got three quid and a button in the case. A button, bruv."] },
    gift: { takes: true, att: 3, accept: ["Twenty?! Nah you're mad. ...I'm keeping it though. Respect."] },
    threat: { action: "walk_away", lines: ["Whoa. Nah. I'm out.", "Not worth it, man. Not worth it."] },
    bye: { hostile: ["Yeah, bye."], neutral: ["Safe."], friend: ["Laters, my g. Come back for the encore."] },
    barks: { work: ["♪ ...and the rain on the river— ♪", "Requests! Anything but Wonderwall."], friendly: ["Oi oi! My g!"], hostile: ["Keep it moving."], night: ["Last song, then bed. Probably."] },
    friends: ["amelie", "tom"],
    favor: {
      need: 1, target: "amelie",
      ask: "Okay don't laugh. That girl who draws by the pub — tell her I wrote a song. Don't say it's about her. It's not. Mostly.",
      remind: "Did you tell her? Did she laugh?",
      thanks: "She said WHAT? ...Okay. Okay okay okay. You're a legend. Here — it's not much.", reward: { cash: 15, att: 3 },
    },
    receives: { edith: { say: "'Acceptable'? From pigeon lady? That's basically a Grammy. Tell her cheers.", emo: "happy", att: 2 } },
    vs: { amelie: "...Hi.", edith: "Morning, Mrs. P!" },
  },
  {
    id: "sofia", name: "Sofia Reyes", short: "Sofia", age: 29, role: "Night-shift nurse", offset: -5,
    look: { shirt: "#3f8f8a", skin: "#c08462", hair: "#2a1d14", pants: "#3f8f8a", longHair: true },
    persona: { brave: 0.6, temper: 0.5, warmth: 0.7 }, walkSpeed: 1.4, jogSpeed: 2.7,
    addr: { hostile: "buddy", neutral: "hon", friend: "hon" },
    quirk: { pre: ["Okay, ", "Look, ", "Honestly? ", "Mm. "], post: ["", ", okay?", ". Anyway."] },
    schedule: [[0, "midW", "lean", "on a break outside St. Agnes"], [7, "times", "eat", "grabbing coffee after her shift"], [9, "home"], [16, "pond", "jog", "jogging over the bay bridge"], [18, "midW", "phone", "calling her brother"], [19, "midW", "lean", "on shift at St. Agnes"]],
    greet: {
      first: ["If you're bleeding, I'm off the clock. If you're not — hi.", "Do I know you? Sorry, I've been awake for nineteen hours."],
      again: ["Oh, hey. You again."],
      friend: ["Hey you. Tell me something that isn't an emergency."],
      hostile: ["Nope. Walk away."],
      busy: ["Two minutes. That's all my break is."],
    },
    small: {
      lean: ["Hospital's packed. Somebody fell off a moving bus. On purpose."],
      phone: ["My brother wants to be a nurse too. I keep telling him to be literally anything else."],
      eat: ["This is my breakfast. It's 7am and I'm going to bed. Don't judge me."],
      jog: ["Running's the only time nobody needs anything from me."],
      any: ["Long day. Long night. They blur."],
    },
    rumors: [
      { t: "We've had three guys in with rope burns on their hands this month. Web-slinger types. Nobody'll explain.", need: -1 },
      { t: "Don't eat the Times plaza hot dogs after six. Trust me. Professionally.", need: 0 },
      { t: "The courier kid, Kenji, rode his bike into my car. Then apologised to the car.", need: 0 },
      { t: "Mac — the tow guy — comes in with bruised knuckles more than a mechanic should.", need: 1 },
    ],
    bio: [
      { t: "Sofia. I'm a nurse at St. Agnes. Nights. Forever, apparently.", need: -2 },
      { t: "I'm saving for my brother's nursing school. Every overtime shift is his tuition.", need: 2 },
      { t: "I used to want to be a singer. Then I wanted rent.", need: 4 },
      { t: "Sometimes I sit in the car before a shift and just... breathe. Don't tell anyone.", need: 6 },
    ],
    deflect: ["I don't have the energy for that conversation.", "Maybe after I've slept. In a week."],
    opinions: {
      mac: "Mac's sweet under all the grumbling. And he grumbles a lot.",
      kenji: "Kenji owes me a bumper. And an apology. Okay, he gave me the apology.",
      vinnie: "That man had a guy carried into my ER and walked out whistling.",
      bernie: "Bernie's coffee is a war crime. I drink it anyway.",
    },
    needs: { hungry: ["I've had a yoghurt and a vending-machine regret today."], tired: ["I could sleep standing up. I have, actually."], broke: ["Tuition's due. I'm doing doubles."] },
    gift: { takes: false, att: 1, refuse: ["Keep it. Seriously. ...Put it toward something nice for yourself."] },
    threat: { action: "phone", lines: ["You picked the wrong nurse. I'm calling security. Real security.", "Try it. I know exactly where it'll hurt."] },
    bye: { hostile: ["Bye."], neutral: ["Stay safe out there."], friend: ["Look after yourself, okay? I mean it."] },
    barks: { work: ["Two more hours...", "Coffee. I need coffee."], friendly: ["Hey, you!"], hostile: ["Don't."], night: ["Night shift, here we go."] },
    friends: ["mac"],
    favor: {
      need: 2, target: "mac",
      ask: "You know Mac? Tow guy, Midtown, grumpy? Tell him his niece Lucia asked about him. He should call his sister. He won't listen to me.",
      remind: "Did you talk to Mac?",
      thanks: "He's calling her? ...Good. Thank you. Really.", reward: { cash: 0, att: 3 },
    },
    receives: { kenji: { say: "He's sorry about the bike thing? He already— ...fine. Tell him apology accepted. Bumper still isn't.", emo: "amused", att: 1 } },
    vs: { mac: "Did you call your sister yet?", kenji: "Bumper, Kenji." },
  },
  {
    id: "vinnie", name: "Vincenzo “Vinnie” Sour", short: "Vinnie", age: 52, role: "Loan “consultant”", offset: 4,
    look: { shirt: "#2a2a2e", skin: "#e0b08c", hair: "#7a7a7a", pants: "#1d1d1d", build: 1.25 }, hat: ["flatcap", "#3a3a3a"],
    persona: { brave: 0.95, temper: 0.35, warmth: 0.2 }, walkSpeed: 1.2,
    addr: { hostile: "friend", neutral: "my friend", friend: "kid" },
    quirk: { pre: ["Ah, ", "See, ", "My friend, "], post: [". Capisce?", ", hm?", ""] },
    schedule: [[0, "broadway", "phone", "doing business"], [3, "home"], [10, "times", "lean", "standing by the hot-dog cart"], [14, "broadway", "phone", "making calls"], [18, "rb", "lean", "waiting for someone"], [21, "broadway", "phone", "doing business"]],
    greet: {
      first: ["Do I know you? No. Do you know me? ...Let's keep it that way.", "Lovely day for a walk. Dangerous, too. For some."],
      again: ["Back again. People always come back to Vinnie."],
      friend: ["Kid! Come, stand with me."],
      hostile: ["You're becoming a problem, friend. I solve problems."],
      busy: ["I'm on an important call. Everything I do is important."],
    },
    small: {
      phone: ["Business is good. Business is always good when people are desperate."],
      lean: ["I'm just a man enjoying the air. Watching. Remembering."],
      any: ["Can't complain. Nobody would dare listen."],
    },
    rumors: [
      { t: "Everybody owes somebody. Most people owe me.", need: -2 },
      { t: "The tow-truck driver, Mac? Lovely family. Big family. I know where all of them live.", need: 0 },
      { t: "The property man, Holloway, borrowed big to buy London. If his deal fails... well.", need: 2 },
      { t: "The cops don't come to Broadway after midnight because I asked them nicely.", need: 4 },
      { t: "There's no ghost in the big wheel. There's a man in pod nine who counts my money.", need: 6 },
    ],
    bio: [
      { t: "Vincenzo Sour. Call me Vinnie. Everybody does. Eventually.", need: -3 },
      { t: "My father sold ice in summer and coal in winter. I sell time.", need: 2 },
      { t: "I have a daughter in Saint-Clair. She thinks I sell insurance. In a way, I do.", need: 5 },
    ],
    deflect: ["Curiosity. Bad habit. Expensive.", "Ask me something cheaper."],
    opinions: {
      mac: "Mac is a good boy with a bad memory for dates. I'm helping him remember.",
      grant: "Mr. Holloway is a valued client. Overvalued, perhaps.",
      bernie: "Bernie sells hot dogs. And he never sees anything. I love that about him.",
      sofia: "The nurse looks at me like I'm a disease. Smart girl.",
    },
    needs: { hungry: ["I'll eat when the work is done. The work is never done."], tired: ["Sleep is for people with clean consciences."], broke: [] },
    gift: { takes: true, att: 2, accept: ["Twenty dollars. You're paying ME? For what? ...I like you. Don't ruin it."] },
    threat: { action: "attack", lines: ["You threaten me? Ha. Let me show you how it's done.", "Oh, that's adorable. Come here."] },
    bye: { hostile: ["Walk carefully."], neutral: ["Ciao."], friend: ["Be good, kid. Or be careful."] },
    barks: { work: ["Mm-hm. Mm-hm. Friday.", "Tell him I said hello. He'll understand."], friendly: ["Kid."], hostile: ["Careful."], night: ["The night is when the interest grows."] },
    friends: ["grant"],
    favor: {
      need: 2, target: "mac",
      ask: "Remind Mac — the tow driver — that I know where his sister lives. Nicely. I'm always nice.",
      remind: "Have you spoken to our friend Mac?",
      thanks: "Good. Messages matter. Here — a tip for the messenger.", reward: { cash: 60, att: 2 },
    },
    receives: { mac: { say: "Friday, he says. Tell Mac... Friday is the last Friday.", emo: "amused", att: 1 } },
    vs: { bernie: "Bernie. You didn't see me.", mac: "Friday, Marco." },
  },
  {
    id: "claude", name: "Claude-Henri Moreau", short: "Claude-Henri", age: 45, role: "Café owner", offset: 0,
    look: { shirt: "#f2efe8", skin: "#e0b08c", hair: "#2a1d14", pants: "#1d1d1d" }, hat: ["beret", "#24304a"], apron: "#ffffff",
    persona: { brave: 0.45, temper: 0.7, warmth: 0.45 }, walkSpeed: 1.3,
    addr: { hostile: "monsieur", neutral: "mon ami", friend: "mon cher" },
    quirk: { pre: ["Bof, ", "Ah, ", "Écoute, ", "Oh là là, "], post: [", voilà.", ", non?", ". C'est la vie.", ""] },
    schedule: [[0, "home"], [7, "plaza", "sweep", "opening up the café"], [9, "plaza", "serve", "running the café"], [15, "plaza", "smoke", "on a cigarette break"], [16, "plaza", "serve", "running the café"], [22, "home"]],
    greet: {
      first: ["Table for one? We only have tables for discerning people. Sit.", "You are blocking my terrace, mon ami."],
      again: ["Ah. The regular who never orders."],
      friend: ["Mon cher! The good cup, for you. Not the tourist cup."],
      hostile: ["We are closed. For you, we are always closed."],
      busy: ["One moment — I am explaining to a tourist that cappuccino is a breakfast drink."],
    },
    small: {
      sweep: ["Every morning I sweep. Every morning the pigeons undo my art."],
      serve: ["Café Lumière across the plaza serves coffee in PAPER cups. Paper. I weep."],
      smoke: ["Doctor says stop. Doctor is not running a café."],
      any: ["Business is... bof."],
    },
    rumors: [
      { t: "The Lumière owner buys his croissants frozen. FROZEN. I have seen the boxes.", need: -1 },
      { t: "The fountain was built by Napoleon himself. ...Fine, by a man who admired him very much.", need: 0 },
      { t: "Holloway wants to turn my café into 'a lifestyle concept'. I would rather be buried in it.", need: 0 },
      { t: "Amélie, the art student — her parents own half the boulevard. She pays for her coffee in coins. Interesting, non?", need: 2 },
    ],
    bio: [
      { t: "Claude-Henri Moreau. This café was my grandmother's. Now it is my problem.", need: -2 },
      { t: "Rent went up forty percent. Forty! I serve coffee, not gold.", need: 1 },
      { t: "I was a chef in a famous kitchen once. I threw a pan at a critic. A small pan.", need: 4 },
      { t: "If Holloway buys the building, I will open a café on the moon. The rent is cheaper.", need: 5 },
    ],
    deflect: ["I am French. I do not discuss my feelings before noon.", "Non."],
    opinions: {
      grant: "Holloway? A man who drinks oat-milk lattes and calls it coffee.",
      amelie: "Amélie draws my terrace every afternoon. Badly. Charmingly.",
      bernie: "There is a man in Midtown who sells 'coffee' from a cart. I have nightmares.",
      kenji: "The courier drinks espresso like a shot of tequila. Animal.",
    },
    needs: { hungry: ["I am surrounded by pastry and I have not eaten. The irony, it kills me."], tired: ["I open at seven, I close at ten. I sleep in the gaps."], broke: ["Look at my till. It is crying."] },
    gift: { takes: true, att: 2, accept: ["For the café? ...Merci. Truly. Sit — the next one is free."] },
    threat: { action: "phone", lines: ["Get off my terrace before I call the gendarmes!", "In MY café? I am calling the police. And my cousin."] },
    bye: { hostile: ["Au revoir. Far away."], neutral: ["Bonne journée."], friend: ["À bientôt, mon cher!"] },
    barks: { work: ["Café! Real café!", "Non, non, NON, not on the clean table!"], friendly: ["Ah! Bonjour!"], hostile: ["Tch."], night: [] },
    friends: ["amelie"],
    favor: {
      need: 1, target: "bernie",
      ask: "You go to Midtown? Tell the hot-dog man, Bernie, that his coffee is a crime against France. He must know.",
      remind: "Has the criminal been informed?",
      thanks: "He invited me to TRY it?! ...Never. Maybe. Here, for your courage.", reward: { cash: 20, att: 2 },
    },
    receives: { grant: { say: "Double? Tell Monsieur Holloway he can double it again and put it somewhere the sun does not shine.", emo: "angry", att: 2 } },
    vs: { grant: "Your 'latte' is ready, Monsieur Holloway. I spat in it. Joke. Maybe.", amelie: "Amélie! The usual? On the house." },
  },
  {
    id: "amelie", name: "Amélie Durand", short: "Amélie", age: 19, role: "Art student", offset: -4,
    look: { shirt: "#d98aa0", skin: "#e0b08c", hair: "#b08a50", pants: "#2b3a55", longHair: true }, hat: ["beret", "#b8261f"],
    persona: { brave: 0.3, temper: 0.2, warmth: 0.65, curious: 0.9 }, walkSpeed: 1.3,
    addr: { hostile: "...you", neutral: "hey", friend: "you" },
    quirk: { pre: ["Um, ", "Oh— ", "Honestly, ", "Like, "], post: ["...", "", ", I guess.", ", you know?"] },
    schedule: [[0, "londonPub", "lean", "listening to the busker"], [2, "home"], [10, "pond", "paint", "painting the bay from the bridge"], [15, "fountain", "paint", "sketching the fountain"], [20, "londonPub", "lean", "listening to the busker"]],
    greet: {
      first: ["Oh! Sorry, I didn't see you. I was looking at the light. It's doing a thing.", "Hi... are you in my drawing? You're kind of in my drawing."],
      again: ["Oh, hi again..."],
      friend: ["You came back! Look, I finished the sky."],
      hostile: ["...Please just leave me alone."],
      busy: ["Wait, wait — the light's perfect right now — okay. Hi."],
    },
    small: {
      paint: ["The water never stays still. Which is rude, but also the point.", "I'm supposed to be in a lecture about light right now. I'm literally doing light."],
      lean: ["He's playing the new one. I think it's new. I've heard all the others."],
      any: ["I'm just... noticing stuff."],
    },
    rumors: [
      { t: "Claude-Henri at the café pretends to hate everyone. He gave me free croissants for a month when I was sad.", need: -1 },
      { t: "I think the pond fish are all one fish that swims really fast.", need: 0 },
      { t: "There's a boy who busks in London... his music sounds like how rain looks. Um. Forget I said that.", need: 1 },
      { t: "My father wants me to marry someone 'from a good family'. He means Grant Holloway's son. Ew.", need: 4 },
    ],
    bio: [
      { t: "I'm Amélie. I draw stuff. Mostly things that won't stay still.", need: -2 },
      { t: "I don't really talk to people. I talk to paper. Paper's nicer.", need: 2 },
      { t: "My parents think I'm studying law. I've been at art school for a year. They pay the 'law' fees.", need: 3 },
      { t: "There's this one song I listen to every night. It has twelve plays. Some of them are mine. Most of them.", need: 5 },
    ],
    deflect: ["Um... I'd rather not?", "That's kind of a lot. Sorry."],
    opinions: {
      jay: "The busker? I don't know him. I mean I know OF him. I mean— why?",
      claude: "Claude-Henri is grumpy like a cat is grumpy. Secretly soft.",
      tom: "Old Tom lets me draw him. He tells me a different story every time.",
      grant: "Mr. Holloway calls my paintings 'cute'. I'd like to paint him into a swamp.",
    },
    needs: { hungry: ["I forgot to eat again. I always forget when the light's good."], tired: ["I was up till four painting the same tree."], broke: ["I have three euros and a very nice brush."] },
    gift: { takes: false, att: 2, refuse: ["Oh, no, no, I can't— keep it. Really. That's... sweet though."] },
    threat: { action: "flee", lines: ["Please don't— I'm going, I'm going!", "Leave me alone!"] },
    bye: { hostile: ["..."], neutral: ["Bye..."], friend: ["See you! I'll draw you in next time. Badly."] },
    barks: { work: ["Stay still, cloud...", "Hmm. More blue."], friendly: ["Oh! Hi!"], hostile: ["..."], night: ["Is it late? It's late."] },
    friends: ["claude", "tom", "jay"],
    favor: {
      need: 2, target: "tom",
      ask: "Could you give this sketch to Old Tom on the embankment? It's him. As a captain. Like he says he was.",
      remind: "Did Tom like it? Did he say anything?",
      thanks: "He's going to frame it? On what wall? ...Oh. Oh, that's— thank you.", reward: { cash: 0, att: 3 },
    },
    receives: { jay: { say: "He— wrote a song? Not about me. Obviously. ...Is it about me? Don't answer. Tell him I'll be by the pub tonight. I'm always by the pub. Okay bye.", emo: "happy", att: 2 } },
    vs: { jay: "...That one's my favourite.", claude: "Merci, Claude-Henri!" },
  },
  {
    id: "bernie", name: "Bernard “Bernie” Kowalski", short: "Bernie", age: 58, role: "Hot-dog & newspaper vendor", offset: 1,
    look: { shirt: "#c0392b", skin: "#e0b08c", hair: "#8a8a8a", pants: "#4a4a4a", build: 1.32, beard: true }, hat: ["paper", "#ffffff"], apron: "#f4f1ea",
    persona: { brave: 0.4, temper: 0.4, warmth: 0.8 }, walkSpeed: 1.1,
    addr: { hostile: "buddy", neutral: "pal", friend: "my friend" },
    quirk: { pre: ["I'm telling ya, ", "Listen, listen, ", "Hey, hey — ", "Now see, "], post: [", I'm telling ya!", ". Swear on my mother.", ", you heard it here first.", ""] },
    schedule: [[0, "home"], [6, "times", "vendor", "selling hot dogs and papers"], [21, "home"]],
    greet: {
      first: ["Hot dogs! Papers! Information! First two cost money.", "Hey, new face! Mustard or onions? Both? Good man."],
      again: ["My guy! Back for seconds?"],
      friend: ["There he is! This one's on the house — don't tell nobody."],
      hostile: ["Nah, nah, I don't serve you no more."],
      busy: ["One sec, one sec, line's out to the curb— okay, what?"],
    },
    small: {
      vendor: ["Sold ninety-three dogs today. Ninety-four if you're hungry, I'm telling ya.", "Front page's the big wheel in London. Nobody asks who's IN the wheel. Think about it."],
      any: ["Thirty-one years on this corner. Seen it all."],
    },
    rumors: [
      { t: "The big wheel in London? Built to spy on us. Every pod's a camera. I'm telling ya.", need: -2 },
      { t: "Broadway racers meet at midnight by the roundabout. Loud. Pretty, though.", need: 0 },
      { t: "Mac the tow guy's been looking over his shoulder all week. Somebody's leaning on him.", need: 0 },
      { t: "Guy in a nice coat stands by my cart every day. Never buys a dog. Never! Suspicious.", need: 1 },
      { t: "Real talk? Vinnie Sour pays me to not see things. I'm very good at not seeing things.", need: 5 },
    ],
    bio: [
      { t: "Bernie Kowalski! Thirty-one years at this corner. The corner's younger than my cart.", need: -3 },
      { t: "My wife Dot makes the onions. Secret recipe. The secret is onions.", need: 1 },
      { t: "My boy's in college. First Kowalski with a degree. Philosophy. Dunno what it's for, but I'm proud.", need: 3 },
      { t: "I seen a lotta things from this cart. Some things I wish I didn't.", need: 5 },
    ],
    deflect: ["Me? Eh, I'm just the hot-dog guy.", "Buy a dog, then we'll talk!"],
    opinions: {
      vinnie: "The coat guy? Don't know him. Never seen him. Who?",
      mac: "Mac's a good kid. Bad luck follows him like a dog follows my cart.",
      sofia: "The nurse! A saint. Drinks my coffee. Brave woman.",
      kenji: "That courier kid owes me for four dogs and a paper. Four!",
      claude: "Some French guy keeps sending me hate mail about coffee. Coffee's coffee!",
    },
    needs: { hungry: ["I sell hot dogs all day and I'm starving. The universe is cruel."], tired: ["My feet. Thirty-one years on these feet."], broke: ["Cart's paid off. Everything else ain't."] },
    gift: { takes: true, att: 3, accept: ["Whoa, whoa! Twenty? You're a prince! Here, have a dog. Have two!"] },
    threat: { action: "flee", lines: ["Okay, okay! Easy! Take the mustard! Take anything!", "Not the cart! Not the cart!"] },
    bye: { hostile: ["Yeah, yeah."], neutral: ["Come back hungry!"], friend: ["Take care, my friend! Tell your friends!"] },
    barks: { work: ["Hot dogs! Papers! Get your conspiracies here!", "Mustard's free! Opinions extra!"], friendly: ["Hey! My guy!"], hostile: ["Not you again."], night: [] },
    friends: ["mac", "sofia"],
    favor: {
      need: 1, target: "kenji",
      ask: "That courier kid, Kenji, runs by sometimes. Tell him the papers were late AGAIN and he still owes me for four dogs. Four!",
      remind: "Kenji pay up yet? No? Shocking.",
      thanks: "He's paying Friday? Everybody pays Friday in this town! Here, take a dog. And a few bucks.", reward: { cash: 15, att: 2 },
    },
    receives: { claude: { say: "A crime against France? Tell him to come try it! I'll make him a special. Extra crime.", emo: "amused", att: 2 } },
    vs: { vinnie: "...I didn't see nothing.", mac: "Mac! Usual?" },
  },
  {
    id: "priya", name: "Priya Shah", short: "Priya", age: 38, role: "City architect", offset: 3,
    look: { shirt: "#2f4f6f", skin: "#8d5a3c", hair: "#111111", pants: "#1d1d1d", longHair: true }, glasses: true,
    persona: { brave: 0.7, temper: 0.55, warmth: 0.4 }, walkSpeed: 1.6,
    addr: { hostile: "you", neutral: "sorry, hi", friend: "you" },
    quirk: { pre: ["Sorry — ", "Right. ", "Quickly: ", "Okay, so "], post: [". Sorry, call.", ". Busy.", ""] },
    schedule: [[0, "home"], [8, "square", "inspect", "inspecting the garden square"], [12, "highSt", "eat", "grabbing lunch"], [13, "wheel", "phone", "on a call about the wheel"], [16, "circus", "inspect", "surveying the circus"], [20, "home"]],
    greet: {
      first: ["Hi — sorry — do you have a question? Thirty seconds.", "Are you from the council? No? Then I have thirty seconds."],
      again: ["You again. Twenty seconds."],
      friend: ["Oh good, a human who isn't on a conference call."],
      hostile: ["I don't have time for you. Ever."],
      busy: ["I'm literally on a call. Literally."],
    },
    small: {
      inspect: ["This square's been here since 1790. It is not 'underutilised land'."],
      phone: ["The committee wants 'stakeholder synergy'. I want them to read a map."],
      eat: ["Lunch is twelve minutes. I've used nine."],
      any: ["Busy. Always busy."],
    },
    rumors: [
      { t: "Holloway's filed plans to 'regenerate' the garden square. Regenerate means bulldoze.", need: -1 },
      { t: "The wheel's foundations were poured in a hurry. It's fine. Probably. I'm checking.", need: 1 },
      { t: "There's an old pump house under the square. Nobody can find the drawings. Convenient.", need: 2 },
      { t: "Someone at the council is taking money from Holloway. I'm going to find out who.", need: 4 },
    ],
    bio: [
      { t: "Priya Shah. I design bits of this city, then spend ten years defending them.", need: -2 },
      { t: "I designed the railings on the new bridge. People lean on them. That's the whole point.", need: 1 },
      { t: "My mum calls every day at half twelve to ask if I've eaten. I never have.", need: 3 },
      { t: "I nearly quit last year. Then Holloway tried to buy the square and I got angry instead.", need: 5 },
    ],
    deflect: ["I don't do small talk. Or large talk, actually.", "Not relevant. Next question."],
    opinions: {
      grant: "Grant Holloway would sell his own skyline if the price was right.",
      edith: "Mrs. Pemberton sends me handwritten letters about benches. I love her.",
      tom: "Tom knows more about this river than the drainage department.",
      kenji: "The courier's the only person who delivers my plans on time.",
    },
    needs: { hungry: ["I haven't eaten since — what day is it?"], tired: ["I answered emails at 3am. The emails answered back."], broke: [] },
    gift: { takes: false, att: 0, refuse: ["Is this a bribe? I report bribes. ...Keep your money, it's fine."] },
    threat: { action: "phone", lines: ["I'm recording this. And calling the police. Both. Simultaneously.", "Wow. Okay. That's going in my complaint."] },
    bye: { hostile: ["Go."], neutral: ["Right. Bye. Sorry."], friend: ["Thanks for — that. Bye!"] },
    barks: { work: ["No, the OTHER drawing.", "Who approved THIS?"], friendly: ["Hi! Busy! Hi!"], hostile: ["Not now."], night: [] },
    friends: ["edith", "tom"],
    favor: {
      need: 2, target: "grant",
      ask: "Do me a favour: if you see Grant Holloway, tell him the heritage listing's been filed. Watch his face. Tell me about his face.",
      remind: "Has Holloway heard yet?",
      thanks: "He went red? Purple? Both? ...Best day of my month. Here — lunch is on me.", reward: { cash: 30, att: 3 },
    },
    receives: { tom: { say: "The pump house floods every spring tide? ...That's it. That's why the foundations can't hold. Thank him. Thank him a lot.", emo: "happy", att: 3 } },
    vs: { grant: "The square isn't for sale, Grant.", edith: "Mrs. Pemberton! Got your letter." },
  },
  {
    id: "tom", name: "Thomas “Old Tom” Hale", short: "Tom", age: 63, role: "Ex-sailor", offset: -1,
    look: { shirt: "#5b4a3c", skin: "#e0b08c", hair: "#cfcfcf", pants: "#3d3d3d", beard: true }, hat: ["beanie", "#2f4a3a"],
    persona: { brave: 0.5, temper: 0.3, warmth: 0.75, elderly: true }, walkSpeed: 0.8,
    addr: { hostile: "landlubber", neutral: "sailor", friend: "shipmate" },
    quirk: { pre: ["Ahh, ", "Now then, ", "Y'see, ", "Heh. "], post: [", mark my words.", ", sailor.", "... where was I?", ""] },
    schedule: [[0, "embank", "sleep", "asleep under his coat"], [7, "embank", "drink", "watching the river"], [12, "bridge", "beg", "asking for change on the bridge"], [17, "embank", "drink", "watching the river"], [22, "embank", "sleep", "asleep under his coat"]],
    greet: {
      first: ["Spare a coin for an old sea dog? No? Spare a minute then.", "Ahoy. You've the look of someone who's lost. We all are, sailor."],
      again: ["Back on the tide, are you?"],
      friend: ["Shipmate! Sit, sit. The river's telling stories today."],
      hostile: ["Leave an old man be."],
      busy: ["Shh. Watch the water a minute."],
    },
    small: {
      drink: ["The river don't judge. It just moves on. Like everybody."],
      beg: ["Coin for the river fund? I'm the river fund."],
      sleep: ["Mmph... five more minutes, captain..."],
      any: ["Another day above water."],
    },
    rumors: [
      { t: "There's a sunken barge under the third bridge. Full of gold. Or turnips. One of the two.", need: -1 },
      { t: "The river rises a hand's width every year. I'm writing it on the wall, I am.", need: 0 },
      { t: "The pump house under that garden square floods every spring tide. Nobody asks me. Nobody asks Tom.", need: 2 },
      { t: "Men in suits came down the embankment at night, dumped something heavy. Pod nine on the wheel stayed lit all night.", need: 4 },
    ],
    bio: [
      { t: "Thomas Hale. Merchant navy, thirty years. Call me Tom. Everybody does, when they call me anything.", need: -3 },
      { t: "Had a wife in Lisbon. Or she had me. Forty years ago now.", need: 2 },
      { t: "Got a medal for pulling five men out of the North Sea. Pawned it. Wish I hadn't.", need: 4 },
      { t: "Some nights I forget which port I'm in. This one's alright though.", need: 6 },
      { t: "There's a night at sea I don't talk about. A storm, and a lad, and a line I threw too short.", need: 8 },
    ],
    deflect: ["Long story, sailor. Longer than your patience.", "Ask me another day. A better day."],
    opinions: {
      edith: "Mrs. Pemberton brings me tea in a flask. Fine woman. Terrifying.",
      amelie: "The girl draws me like I'm somebody. Nice feeling, that.",
      priya: "The architect listens. Rare thing.",
      grant: "Holloway had me 'moved on' twice. River moved me back.",
      laxmi: "The lady from the temple square? She sends me word now and then. I never know what to say back.",
      jay: "The lad sings my old shanties wrong. Wrong and lovely.",
    },
    needs: { hungry: ["Ain't eaten since yesterday. Or the day before. Days are slippery."], tired: ["These bones have been cold a long time."], broke: ["Broke? I'm beyond broke, sailor. I'm out the other side of it."] },
    gift: { takes: true, att: 4, accept: ["Bless you, sailor. Bless you. That's a hot meal, that is."] },
    threat: { action: "flee", lines: ["Easy, easy... I'm old, not stupid.", "Take it — it's nothing — leave me be!"] },
    bye: { hostile: ["Fair winds. Far away."], neutral: ["Fair winds, sailor."], friend: ["Fair winds and following seas, shipmate."] },
    barks: { work: ["♪ Way, haul away... ♪", "Tide's turning."], friendly: ["Ahoy!"], hostile: ["Hmph."], night: ["Cold one tonight."] },
    friends: ["edith", "amelie", "jay"],
    favor: {
      need: 2, target: "priya",
      ask: "That architect lady, Ms. Shah — tell her the pump house under the garden square floods every spring tide. She'll know what that means.",
      remind: "Did the architect hear old Tom?",
      thanks: "She thanked me? ...Nobody thanks Tom. Here — a lucky coin. Spent the luck, kept the coin.", reward: { cash: 5, att: 3 },
    },
    receives: { amelie: { say: "That's me? Captain Hale... Look at that. Tell the girl I'll frame it. I'll find a wall.", emo: "sad", att: 3 } },
    vs: { jay: "Wrong verse, lad!", edith: "Morning, Mrs. P." },
  },
  {
    id: "grant", name: "Grant Holloway", short: "Holloway", age: 47, role: "Property developer", offset: 3.5,
    look: { shirt: "#5a6470", skin: "#e0b08c", hair: "#5a3a20", pants: "#3d4450" },
    persona: { brave: 0.55, temper: 0.6, warmth: 0.15 }, walkSpeed: 1.55,
    addr: { hostile: "you", neutral: "friend", friend: "partner" },
    quirk: { pre: ["Look, ", "Frankly, ", "Here's the thing: ", "Bottom line? "], post: [". Win-win.", ", going forward.", ". Time is money.", ""] },
    schedule: [[0, "home"], [9, "midE", "phone", "closing a deal"], [12, "plaza", "eat", "having lunch at the café"], [14, "square", "inspect", "measuring up the garden square"], [18, "wheel", "phone", "on the phone by the wheel"], [21, "home"]],
    greet: {
      first: ["Grant Holloway, Holloway Living. You look like someone who appreciates opportunity.", "Make it quick, I bill in fifteen-minute increments."],
      again: ["Ah. My shadow."],
      friend: ["Partner! Walk with me, talk with me."],
      hostile: ["Security's on speed dial, friend."],
      busy: ["Hold that thought — I'm closing."],
    },
    small: {
      phone: ["Tell them double. If they say no, tell them triple and mean double."],
      inspect: ["Imagine this square... but premium."],
      eat: ["Oat latte. The café man looked at me like I'd shot his dog."],
      any: ["Every street's a spreadsheet if you look at it right."],
    },
    rumors: [
      { t: "Saint-Clair is undervalued. Old buildings, old people, old money. Ripe.", need: -2 },
      { t: "The café owner will sell. Everyone sells. The only question is the number.", need: 0 },
      { t: "Between us: the wheel's land lease runs out next year. Someone's going to own the view.", need: 2 },
      { t: "My investors aren't the patient kind. I may have... borrowed creatively.", need: 5 },
    ],
    bio: [
      { t: "Grant Holloway. You've seen my name on the hoardings.", need: -3 },
      { t: "Started with one flat in Midtown. Now I have forty. Buildings, not flats.", need: 1 },
      { t: "My father sold shoes. He died broke. I won't.", need: 4 },
      { t: "If the London deal falls through I lose everything. Everything. So it won't fall through.", need: 6 },
    ],
    deflect: ["My life story is under NDA.", "Let's talk numbers, not feelings."],
    opinions: {
      priya: "Ms. Shah is a talented obstacle.",
      claude: "The café man's emotionally attached to a building. Bad business.",
      vinnie: "Vinnie? We've... done business. He's very flexible on terms.",
      edith: "The pigeon lady wrote my name in her notebook. I don't like that.",
    },
    needs: { hungry: ["Haven't had time to eat. Lunch is for people without investors."], tired: ["Slept four hours. I'm told that's a competitive advantage."], broke: [] },
    gift: { takes: true, att: 1, accept: ["You're... giving ME money? Bold strategy. I respect it. Ha!"] },
    threat: { action: "phone", lines: ["Do you know who I am? I'm calling my lawyers. All of them.", "Bad move. Very bad move."] },
    bye: { hostile: ["We're done here."], neutral: ["Let's circle back."], friend: ["Ping me, partner."] },
    barks: { work: ["Prime frontage, prime frontage.", "No, I said TRIPLE."], friendly: ["Partner!"], hostile: ["Not interested."], night: [] },
    friends: ["vinnie"],
    favor: {
      need: 1, target: "claude",
      ask: "Do something for me: tell the café owner in Saint-Clair my offer stands. Double. He'll pretend to be offended. Tell me how long he pretends.",
      remind: "Did the café man give you an answer?",
      thanks: "He said WHAT? ...Fine. Every 'no' has a price. Here, a consultancy fee.", reward: { cash: 50, att: 2 },
    },
    receives: { priya: { say: "She filed a HERITAGE LISTING? ...Get out of my sight. And tell her — no. Don't tell her anything.", emo: "angry", att: -3 } },
    vs: { claude: "Thought about my offer, Moreau?", priya: "Ms. Shah. Always a pleasure. Never a profit." },
  },
  {
    id: "laxmi", name: "Martha Bell", short: "Martha", age: 61, role: "Temple caretaker", offset: -1.5,
    look: { shirt: "#a8232e", sleeve: "#c9a227", skin: "#a8724e", hair: "#1a1410", pants: "#5a1a22", longHair: true },
    persona: { brave: 0.7, temper: 0.35, warmth: 0.85 }, walkSpeed: 1.0,
    addr: { hostile: "you", neutral: "dear", friend: "my child" },
    quirk: { pre: ["Listen, ", "Dear, ", "My mother used to say — ", "Child, "], post: [". What can you do.", ", hm?", ". The gods are watching.", ""] },
    schedule: [[0, "home"], [5, "durbar", "sweep", "sweeping the temple steps"], [9, "durbar", "inspect", "looking after the shrines"], [13, "durbar", "eat", "eating rice in the shade"], [15, "durbar", "inspect", "lighting the evening lamps"], [20, "home"]],
    greet: {
      first: ["Hello, dear. You're new to Kathmandu — I can tell, you're looking up at everything.", "Good day. Mind the pigeons, they think they own the square."],
      again: ["Hello again, dear."],
      friend: ["Ah, my child! Come, sit. Have you eaten?"],
      hostile: ["Leave the square. The gods don't need your kind of trouble."],
      busy: ["One moment — the lamps don't light themselves."],
    },
    small: {
      sweep: ["Two hundred years these steps have been swept every morning. Not one day missed."],
      inspect: ["The struts on the pagoda — every one carved by hand. Gods, dancers, demons. Look closely."],
      eat: ["Rice and a little pickle. Simple food for a long life."],
      any: ["The hills hold the city like two hands.", "Everything here is older than it looks, and stronger."],
    },
    rumors: [
      { t: "There are boats at the west jetty now. Fishermen, they say. Fishermen with very clean hands.", need: -2 },
      { t: "Old Tom the sailor knows every current in that bay. Ask him if you ever take a boat out.", need: 0 },
      { t: "A rich man from London has been buying 'antiques'. Nothing he buys is antique to us — it's family.", need: 2 },
    ],
    bio: [
      { t: "Martha Bell. My mother kept this square, and her mother before her.", need: -3 },
      { t: "I was born in the lane behind the palace. I've never slept a night outside the valley.", need: 1 },
      { t: "My son went to sea. He sends letters. I read them to the goddess, she likes to hear about the world.", need: 4 },
    ],
    deflect: ["That is my business, dear.", "Ask me again when you've had tea with me."],
    opinions: {
      tom: "The sailor? A good man who drinks a little. The sea does that.",
      grant: "Holloway. I've heard that name, and not kindly.",
      priya: "The architect girl drew our palace once. Beautifully. She understands old stones.",
    },
    needs: { hungry: ["Have you eaten? I haven't. Too much to do."], tired: ["My knees are older than the pagoda today."], broke: [] },
    gift: { takes: true, att: 2, accept: ["For the temple? The goddess thanks you. So do I."] },
    threat: { action: "none", lines: ["You'd threaten an old woman in front of the gods? Shame.", "Go on, then. I've seen worse than you."] },
    bye: { hostile: ["Go."], neutral: ["Go well, dear."], friend: ["Come back for tea, my child."] },
    barks: { work: ["Hmm, hmm, hmm...", "Shoo, pigeons, shoo!"], friendly: ["My child!"], hostile: ["Not you again."], night: ["The lamps are lit. Go home, dear."] },
    friends: ["tom"],
    favor: {
      need: 1, target: "tom",
      ask: "Will you do an old woman a favour? Tell the sailor Tom that his letter came — he'll know which one.",
      remind: "Did you find the sailor?",
      thanks: "He cried? Good. Some letters should make you cry. Here — for the walk.", reward: { cash: 30, att: 2 },
    },
    receives: {},
    vs: {},
  },
  {
    id: "kenji", name: "Kenji Watanabe", short: "Kenji", age: 27, role: "Courier", offset: 5,
    look: { shirt: "#27ae60", sleeve: "#1d1d1d", skin: "#e0b08c", hair: "#111111", pants: "#1d1d1d" }, hat: ["cap", "#111111"], backpack: "#f1c40f",
    persona: { brave: 0.65, temper: 0.4, warmth: 0.6 }, walkSpeed: 3.1,
    addr: { hostile: "dude", neutral: "dude", friend: "bro" },
    quirk: { pre: ["Yo — ", "Okay okay — ", "Quick quick — ", "Dude, "], post: [", gotta go!", ", no time!", ". Anyway!", ""] },
    schedule: [[0, "home"], [8, "times", "run", "on a delivery"], [10, "plaza", "run", "on a delivery"], [12, "rb", "eat", "on a lunch break"], [13, "highSt", "run", "on a delivery"], [15, "clock", "lean", "waiting on a pickup"], [17, "stclairS", "run", "on a delivery"], [19, "bridge", "lean", "catching his breath"], [21, "home"]],
    greet: {
      first: ["Hey! Can't stop — can stop — okay I stopped. What?", "You lost? I know every street. EVERY street."],
      again: ["Ha, you again!"],
      friend: ["Bro! Race you to the bridge. Kidding. Unless?"],
      hostile: ["Nope. Gone."],
      busy: ["Delivery! Thirty seconds late! Talk fast!"],
    },
    small: {
      run: ["Midtown to London in eleven minutes. Personal best. Legally? Mostly."],
      eat: ["Lunch is an energy gel and vibes."],
      lean: ["Waiting on a pickup. Waiting is my nemesis."],
      any: ["Gotta keep moving or I fall over."],
    },
    rumors: [
      { t: "London streets aren't a grid. They're a maze someone drew while sneezing.", need: -1 },
      { t: "The clock tower's accurate to the second. I check it every day. ...It's four minutes slow.", need: 0 },
      { t: "Shortcut from Saint-Clair to Midtown: straight through the park. Pond's in the way. Just jump.", need: 0 },
      { t: "I deliver envelopes to the big wheel every Tuesday. Pod nine. Never asked what's in 'em.", need: 3 },
      { t: "Holloway's envelopes go to a guy in a nice coat in Midtown. Same coat every time.", need: 4 },
    ],
    bio: [
      { t: "Kenji! Fastest courier in three cities. Unofficial title. Self-awarded.", need: -3 },
      { t: "Quit a bank job to do this. Mum still tells people I'm 'in finance'.", need: 2 },
      { t: "I'm saving for the cycling championships in Kyoto. Two more years of deliveries.", need: 4 },
      { t: "I clipped the nurse's car. Sofia. I feel bad every time I ride past the hospital.", need: 5 },
    ],
    deflect: ["Long story, short legs — no wait, opposite.", "No time for me-time!"],
    opinions: {
      bernie: "Bernie! I owe him for... some dogs. Many dogs.",
      sofia: "The nurse... yeah. I owe her a bumper. And probably more.",
      priya: "Priya tips in compliments. Weirdly I'll take it.",
      mac: "Mac tried to tow my bike once. My BIKE.",
      grant: "Holloway gives me sealed envelopes and says 'no peeking'. I don't peek. Much.",
    },
    needs: { hungry: ["I've burned four thousand calories and eaten a banana."], tired: ["My legs have filed a complaint."], broke: ["Courier money is 'exposure money' with extra steps."] },
    gift: { takes: true, att: 2, accept: ["Whoa! Thanks! That's like... three tyres! Two tyres. One good tyre."] },
    threat: { action: "flee", lines: ["Nah dude, I'm faster than your problems.", "Byeee!"] },
    bye: { hostile: ["Later. Much later."], neutral: ["Gotta run! Literally!"], friend: ["Catch you on the road, bro!"] },
    barks: { work: ["On your left!", "Coming through!"], friendly: ["Yo!"], hostile: ["Pfft."], night: [] },
    friends: ["priya", "bernie"],
    favor: {
      need: 1, target: "sofia",
      ask: "If you see Sofia — the nurse, Midtown, scrubs, looks tired — tell her I'm sorry about the bike thing. Again. I'll fix her bumper. Eventually.",
      remind: "Did she forgive me? She didn't, did she.",
      thanks: "She laughed? That's basically forgiveness! You're a legend. Delivery fee, on me.", reward: { cash: 20, att: 2 },
    },
    receives: { bernie: { say: "Four dogs?! It was three! ...Tell him Friday. Everybody pays Friday.", emo: "amused", att: 1 } },
    vs: { bernie: "Friday, Bernie! Friday!", mac: "Don't tow me, Mac!" },
  },
];

// ================================================================ save data
const SAVE_KEY = "babylon.story.v1";
let save = { wallet: 200, clock: 0, chars: {}, favors: {} };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) save = { ...save, ...s }; } catch { /* private mode */ }
let saveTimer = 0;
const persist = () => { saveTimer = 1.5; };
function flushSave(dt) {
  if (saveTimer <= 0) return;
  saveTimer -= dt;
  if (saveTimer <= 0) try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* ignore */ }
}
function memOf(id) {
  if (!save.chars[id]) save.chars[id] = { att: 0, met: 0, bio: 0, rumor: 0, hurt: 0, hurtAt: -99, threatened: 0, gifts: 0, gunAt: -99, lastTalk: -99, heard: null, known: false };
  return save.chars[id];
}

// ================================================================ places
const SPOT_INFO = {
  times: ["Times plaza", "Midtown"], rb: ["the Midtown roundabout", "Midtown"], midE: ["east Midtown", "Midtown"],
  midW: ["St. Agnes hospital", "Midtown"], broadway: ["Broadway", "Midtown"], plaza: ["the café on the Saint-Clair plaza", "Saint-Clair"],
  fountain: ["the Saint-Clair fountain", "Saint-Clair"], stclairS: ["south Saint-Clair", "Saint-Clair"], pond: ["the bay bridge", "the Bay"],
  clock: ["the clock tower", "London"], wheel: ["the big wheel", "London"], square: ["the garden square", "London"],
  circus: ["the circus", "London"], highSt: ["the high street", "London"], londonPub: ["the Red Lion", "London"],
  bridge: ["the bridge", "London"], embank: ["the embankment", "London"],
  durbar: ["Palace Square", "Kathmandu"],
};
const SPOTS = {};
function nearestRoad(x, z, filter) {
  let best = null, bd = Infinity;
  for (const e of edges) {
    if (filter && !filter(e)) continue;
    for (let i = 0; i < e.xs.length; i++) {
      const d = (e.xs[i] - x) ** 2 + (e.zs[i] - z) ** 2;
      if (d < bd) { bd = d; best = { e, s: e.cum[i] }; }
    }
  }
  return best;
}
function makeSpot(key, x, z, filter, faceRoad = true) {
  const r = nearestRoad(x, z, filter) || nearestRoad(x, z);
  if (!r) return;
  const e = r.e, s = clamp(r.s, Math.min(9, e.len / 2), Math.max(e.len - 9, e.len / 2));
  const q = pathAt(e, s, {});
  const side = (x - q.x) * q.tz - (z - q.z) * q.tx >= 0 ? 1 : -1;
  SPOTS[key] = { key, name: SPOT_INFO[key][0], city: SPOT_INFO[key][1], e, s, side, faceRoad };
}
function spotXZ(sp, s, lat = 0.55) {
  const q = pathAt(sp.e, clamp(s, 0, sp.e.len), {});
  const off = (sp.e.w / 2 + sp.e.sw * lat) * sp.side;
  return [q.x + q.tz * off, q.z - q.tx * off, Math.atan2(q.tx, q.tz)];
}
function resolveSpots() {
  const L = landmarks, city = (e) => e.district === "city", paris = (e) => e.district === "paris", lon = (e) => e.district === "london";
  if (L.times) makeSpot("times", L.times.x, L.times.z, city);
  if (L.roundabout) makeSpot("rb", L.roundabout.x + L.roundabout.r + 18, L.roundabout.z, city);
  makeSpot("midE", 585, 70, city);
  makeSpot("midW", -60, -150, city);
  const bw = edges.find((e) => e.kind === "broadway");
  if (bw) { const q = pathAt(bw, bw.len * 0.72, {}); makeSpot("broadway", q.x + q.tz * 8, q.z - q.tx * 8, (e) => e === bw); }
  makeSpot("plaza", PARIS.x + 50, PARIS.z + 6, paris, false);
  makeSpot("fountain", PARIS.x - 50, PARIS.z - 6, paris, false);
  makeSpot("stclairS", PARIS.x + 30, PARIS.z - 180, paris);
  makeSpot("pond", POND.x, POND.z, (e) => e.district === "park");
  if (L.clockTower) makeSpot("clock", L.clockTower.x, L.clockTower.z, lon);
  if (L.wheel) makeSpot("wheel", L.wheel.x, L.wheel.z, lon);
  const sq = (L.londonSquares || [])[0];
  if (sq) makeSpot("square", sq.x, sq.z, lon, false);
  const ci = (L.londonCircuses || [])[1] || (L.londonCircuses || [])[0];
  if (ci) makeSpot("circus", ci.x + ci.r + 14, ci.z, lon);
  makeSpot("highSt", LON_CORE.x, LON_CORE.z, (e) => e.kind === "high");
  makeSpot("londonPub", 880, 320, (e) => e.kind === "high" && e !== (SPOTS.highSt && SPOTS.highSt.e), false);
  const br = (L.londonBridges || [])[0];
  if (br) { SPOTS.bridge = { key: "bridge", name: "the bridge", city: "London", e: br, s: br.len / 2, side: 1, faceRoad: true }; }
  if (L.ktmDurbar) makeSpot("durbar", L.ktmDurbar.x, L.ktmDurbar.z, (e) => e.district === "kathmandu");
  if (L.clockTower) makeSpot("embank", L.clockTower.x - L.clockTower.tx * 70, L.clockTower.z - L.clockTower.tz * 70, lon, false);
  // anything missing falls back to the nearest Midtown spot
  for (const k of Object.keys(SPOT_INFO)) if (!SPOTS[k]) SPOTS[k] = SPOTS.times || SPOTS.midE;
}

// ================================================================ props at work spots + accessories
const matCache = {};
const M = (c) => (matCache[c] ??= litMat("chrAcc" + c, hex(c), 0.25));
function mergeTo(parts, parent, name) {
  for (const [m, c] of parts) m.material = M(c);
  const mesh = BABYLON.Mesh.MergeMeshes(parts.map((p) => p[0]), true, true, undefined, false, true);
  mesh.name = name; mesh.parent = parent; mesh.isPickable = false;
  return mesh;
}
const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = MB.CreateBox("b", { width: w, height: h, depth: d }, scene); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
const cyl = (dt, db, h, x, y, z, rx = 0, rz = 0, tess = 12) => { const m = MB.CreateCylinder("c", { diameterTop: dt, diameterBottom: db, height: h, tessellation: tess }, scene); m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz; return m; };
const sph = (d, x, y, z, sx = 1, sy = 1, sz = 1, slice = 1) => { const m = MB.CreateSphere("s", { diameter: d, segments: 8, slice }, scene); m.position.set(x, y, z); m.scaling.set(sx, sy, sz); return m; };

function dressUp(c) {
  const p = c.p, d = c.def;
  if (d.hat) {
    const [t, col] = d.hat;
    const parts = {
      cap: [[cyl(0.25, 0.27, 0.11, 0, 0.2, 0), col], [box(0.2, 0.02, 0.14, 0, 0.16, 0.15), col]],
      beanie: [[sph(0.27, 0, 0.16, 0, 1, 1.15, 1, 0.55), col]],
      flatcap: [[sph(0.28, 0, 0.21, -0.01, 1.02, 0.45, 1.08), col], [box(0.2, 0.02, 0.1, 0, 0.19, 0.14), col]],
      beret: [[cyl(0.3, 0.27, 0.06, 0.02, 0.25, 0, 0, 0.25), col]],
      sunhat: [[cyl(0.46, 0.46, 0.02, 0, 0.21, 0, 0, 0, 20), col], [cyl(0.22, 0.25, 0.13, 0, 0.27, 0), col], [cyl(0.255, 0.255, 0.03, 0, 0.23, 0), "#e8d7a0"]],
      paper: [[box(0.27, 0.09, 0.2, 0, 0.27, 0), col]],
    }[t];
    if (parts) mergeTo(parts, p.headPivot, "chrHat");
  }
  if (d.glasses) mergeTo([[box(0.19, 0.035, 0.02, 0, 0.13, 0.115), "#151515"]], p.headPivot, "chrGlasses");
  if (d.apron) mergeTo([[box(0.36, 0.62, 0.03, 0, 1.0, 0.15), d.apron]], p.root, "chrApron");
  if (d.backpack) mergeTo([[box(0.34, 0.42, 0.18, 0, 1.25, -0.22), d.backpack]], p.root, "chrPack");
  // held items, switched on by pose
  const hand = p.arms[1];
  const H = (parts, parent = hand) => { const m = mergeTo(parts, parent, "chrItem"); m.setEnabled(false); return m; };
  c.items = {
    cup: H([[cyl(0.085, 0.07, 0.12, 0, -0.66, 0.05), "#f4f1ea"], [cyl(0.088, 0.088, 0.03, 0, -0.62, 0.05), "#6b4a2a"]]),
    bottle: H([[cyl(0.05, 0.075, 0.26, 0, -0.66, 0.06), "#2f6a3a"]]),
    book: H([[box(0.2, 0.03, 0.26, 0, -0.64, 0.1), "#7a1f1f"]]),
    paper: H([[box(0.32, 0.02, 0.4, 0, -0.66, 0.12, 0.3), "#ebe6d6"]]),
    tray: H([[box(0.36, 0.02, 0.32, 0, -0.63, 0.12), "#b9bec4"], [cyl(0.07, 0.06, 0.09, 0.06, -0.58, 0.12), "#f4f1ea"]]),
    brush: H([[cyl(0.02, 0.015, 0.32, 0, -0.68, 0.12, Math.PI / 2), "#a0703c"], [box(0.03, 0.03, 0.05, 0, -0.68, 0.29), "#d94a4a"]]),
    broom: H([[cyl(0.03, 0.03, 1.4, 0.15, 0.72, 0.42, -0.45), "#8a5a34"], [box(0.42, 0.1, 0.1, 0.15, 0.08, 0.72, 0.3), "#3a2a1a"]], p.root),
  };
  if (d.guitar) {
    const g = mergeTo([[cyl(0.36, 0.36, 0.1, 0, 0, 0, Math.PI / 2), "#8a4a24"], [cyl(0.27, 0.27, 0.105, 0, 0.22, 0, Math.PI / 2), "#8a4a24"],
      [box(0.055, 0.52, 0.03, 0, 0.55, 0.02), "#2a1a10"], [cyl(0.08, 0.08, 0.11, 0, 0.05, 0.005, Math.PI / 2), "#1a1a1a"]], p.root, "chrGuitar");
    c.items.guitar = g;
    c.items.case = H([[box(0.95, 0.1, 0.36, 0, 0.05, 0), "#151515"], [box(0.85, 0.02, 0.28, 0, 0.1, 0), "#7a1f2a"], [cyl(0.03, 0.03, 0.01, 0.1, 0.115, 0.05), "#d8b45a"], [cyl(0.03, 0.03, 0.01, -0.15, 0.115, -0.04), "#c0c0c0"]], p.root);
  }
  if (d.id === "amelie") {
    c.items.easel = H([[box(0.04, 1.65, 0.04, -0.3, 0.82, 0.02, 0.12), "#a0703c"], [box(0.04, 1.65, 0.04, 0.3, 0.82, 0.02, 0.12), "#a0703c"],
      [box(0.04, 1.6, 0.04, 0, 0.78, 0.32, -0.32), "#a0703c"], [box(0.85, 0.65, 0.03, 0, 1.25, -0.04, 0.12), "#f4f1ea"],
      [box(0.5, 0.3, 0.005, -0.1, 1.3, -0.06, 0.12), "#5aa0c8"], [box(0.3, 0.15, 0.005, 0.18, 1.15, -0.065, 0.12), "#e8b04a"]], p.root);
  }
}
// which items each pose uses
const POSE_ITEMS = { eat: ["cup"], drink: ["bottle"], read: ["book"], vendor: ["paper"], serve: ["tray"], paint: ["brush", "easel"], sweep: ["broom"], busk: ["case"] };
function setItems(c) {
  const p = c.p, pose = p.state === "work" ? p.pose : null;
  const want = new Set(pose ? POSE_ITEMS[pose] || [] : []);
  for (const [k, m] of Object.entries(c.items)) if (k !== "guitar") m.setEnabled(want.has(k));
  if (c.items.guitar) {
    const g = c.items.guitar;
    if (pose === "busk") { g.position.set(0.04, 1.02, 0.24); g.rotation.set(0, 0, -1.0); }
    else { g.position.set(0, 1.12, -0.25); g.rotation.set(0, 0, 0.6); }
  }
  if (c.items.easel && want.has("easel")) c.items.easel.position.set(0, 0, 0.8);
  if (c.items.case && want.has("case")) c.items.case.position.set(0.45, 0, 0.85);
  p.phone.setEnabled(p.state === "work" && p.pose === "phone");
}

// static props at a spot: hot-dog cart, café tables, a bench, Tom's bed of cardboard
function propsAt(spotKey, ds, builder) {
  const sp = SPOTS[spotKey];
  if (!sp) return;
  const [x, z, h] = spotXZ(sp, sp.s + ds, 0.82);
  const root = new BABYLON.TransformNode("chrProp", scene);
  root.position.set(x, terrainH(x, z), z); root.rotation.y = h;
  builder(root, x, z, h);
  root.getChildMeshes().forEach((m) => { m.freezeWorldMatrix(); m.isPickable = false; });
}
function buildProps() {
  propsAt("times", 1 + 1.8, (r, x, z, h) => {                                 // Bernie's cart
    mergeTo([[box(0.9, 0.9, 1.7, 0, 0.55, 0), "#e8e4da"], [box(0.92, 0.12, 1.72, 0, 1.05, 0), "#c0392b"], [cyl(0.4, 0.4, 0.08, 0, 0.12, 0.65, 0, Math.PI / 2), "#222222"],
      [cyl(0.4, 0.4, 0.08, 0, 0.12, -0.65, 0, Math.PI / 2), "#222222"], [cyl(0.04, 0.04, 1.3, 0, 1.7, 0), "#888888"], [cyl(0, 2.2, 0.5, 0, 2.4, 0, 0, 0, 8), "#f1c40f"],
      [box(0.5, 0.3, 0.02, 0.46, 0.8, 0), "#c0392b"]], r, "cart");
    addSolidR(x, z, h, 0.5, 0.9, 0, 1.2);
  });
  for (const ds of [-2.6, 2.6]) propsAt("plaza", ds, (r, x, z, h) => {          // café terrace
    mergeTo([[cyl(0.7, 0.7, 0.04, 0, 0.74, 0), "#e9e5dc"], [cyl(0.06, 0.06, 0.72, 0, 0.37, 0), "#25282c"], [box(0.42, 0.04, 0.42, 0.6, 0.45, 0), "#a8763f"],
      [box(0.42, 0.45, 0.04, 0.6, 0.67, 0.2), "#8f6232"], [box(0.42, 0.04, 0.42, -0.6, 0.45, 0), "#a8763f"], [box(0.42, 0.45, 0.04, -0.6, 0.67, -0.2), "#8f6232"]], r, "cafe");
    addSolidR(x, z, h, 0.9, 0.4, 0, 0.75);
  });
  propsAt("plaza", 0.2, (r) => mergeTo([[box(0.6, 0.9, 0.04, 0, 0.45, 0.4, -0.2), "#1d1d1d"], [box(0.5, 0.6, 0.01, 0, 0.52, 0.43, -0.2), "#e8e4da"]], r, "board"));
  propsAt("square", -3 + 1.5, (r, x, z, h) => {                               // bench for Edith
    mergeTo([[box(1.8, 0.06, 0.5, 0, 0.45, 0), "#7a5434"], [box(1.8, 0.45, 0.06, 0, 0.75, -0.25), "#7a5434"], [box(0.06, 0.45, 0.5, -0.8, 0.22, 0), "#25282c"], [box(0.06, 0.45, 0.5, 0.8, 0.22, 0), "#25282c"]], r, "bench");
    addSolidR(x, z, h, 0.9, 0.3, 0, 0.5);
  });
  propsAt("embank", -1 + 1.4, (r) => {                                         // Tom's corner
    mergeTo([[box(1.9, 0.03, 0.9, 0, 0.02, 0), "#b08a5a"], [box(1.4, 0.1, 0.7, 0.1, 0.07, 0), "#4a5a3a"], [box(0.5, 0.35, 0.35, -0.85, 0.18, 0.1), "#9a7a4a"],
      [cyl(0.05, 0.075, 0.26, 0.85, 0.13, 0.2), "#2f6a3a"], [cyl(0.12, 0.1, 0.1, 0.7, 0.05, -0.2), "#b9bec4"]], r, "tomsCorner");
  });
}

// ================================================================ routing (road graph)
class Heap {
  constructor() { this.a = []; }
  push(n, d) { const a = this.a; a.push([d, n]); let i = a.length - 1; while (i) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
function planRoute(c, sp, ts) {
  const p = c.p;
  p.roam = false;
  if (p.e === sp.e) { p.dir = ts >= p.s ? 1 : -1; p.route = []; return; }
  const N = nodes.length, dist = new Float64Array(N).fill(Infinity), prevE = new Array(N), prevN = new Int32Array(N).fill(-1);
  const h = new Heap();
  dist[p.e.a.id] = p.s; h.push(p.e.a.id, p.s);
  if (p.e.len - p.s < dist[p.e.b.id]) { dist[p.e.b.id] = p.e.len - p.s; h.push(p.e.b.id, p.e.len - p.s); }
  const ga = sp.e.a.id, gb = sp.e.b.id;
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    if (d > Math.min(dist[ga] + ts, dist[gb] + sp.e.len - ts)) break;
    for (const e of nodes[u].edges) {
      const v = (e.a.id === u ? e.b : e.a).id, nd = d + e.len;
      if (nd < dist[v]) { dist[v] = nd; prevE[v] = e; prevN[v] = u; h.push(v, nd); }
    }
  }
  let goal = dist[ga] + ts <= dist[gb] + sp.e.len - ts ? ga : gb;
  if (!isFinite(dist[goal])) { p.route = null; return; }
  const path = [];
  let n = goal;
  while (prevN[n] !== -1) { path.push(prevE[n]); n = prevN[n]; }
  path.reverse();
  p.dir = n === p.e.a.id ? -1 : 1;
  path.push(sp.e);
  p.route = path;
}

// ================================================================ runtime state
const chars = [];
const byId = {};
let convo = null, candidate = null, lastCtx = null;
// curHour = the game's time of day; save.clock = game hours elapsed in total
// (persisted, used for "it's been a while" and how fresh grudges are)
let curHour = 9.5, lastHour = null;
const hourNow = () => curHour;

// Only the people the missions need are in the world (the rest of the cast
// stays defined here but isn't spawned), and they only talk about the mission.
const MISSION_CAST = new Set(["laxmi"]);
const storyLines = (c) => (storyHooks.choices ? storyHooks.choices(c) : []);
export function spawnCharacters() {
  resolveSpots();
  buildProps();
  injectUI();
  const any = edges[0];
  for (const def of CAST) {
    if (!MISSION_CAST.has(def.id)) continue;
    const p = spawnCharacter(def, any, 5);
    const c = { def, p, mem: memOf(def.id), need: { hunger: 0.3, energy: 0.85 }, fear: 0, sulk: 0, hold: 0, barkCool: 4 + R() * 10, slotKey: null, bubble: null, tag: null };
    p.state = "away"; p.root.setEnabled(false); p.x = p.z = 1e6;
    dressUp(c); setItems(c);
    makeTagEls(c);
    chars.push(c); byId[def.id] = c;
  }
  pedHooks.onHurt = (p) => charOf(p) && onHurt(charOf(p));
  pedHooks.onGun = (p) => charOf(p) && onGun(charOf(p));
  pedHooks.onScare = (p, x, z, rel) => charOf(p) && onScare(charOf(p), x, z, rel);
  pedHooks.onBarged = (p) => charOf(p) && onBarged(charOf(p));
  window.addEventListener("keydown", onKey);
}
const charOf = (p) => byId[p.char && p.char.id];

function slotOf(c, hour) {
  if (c.forceSlot) { const f = c.forceSlot; return { hour: 0, spot: f.spot, pose: f.pose || "stand", doing: f.doing || "", key: "force:" + f.spot + ":" + f.pose }; }
  const S = c.def.schedule;
  let cur = S[S.length - 1];
  for (const s of S) if (s[0] <= hour) cur = s;
  return { hour: cur[0], spot: cur[1], pose: cur[2] || "stand", doing: cur[3] || "", key: cur[0] + ":" + cur[1] };
}
const targetS = (c, sp) => clamp(sp.s + c.def.offset, 1.5, sp.e.len - 1.5);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
function arrive(c, slot) {
  const p = c.p, sp = SPOTS[slot.spot];
  c.slotKey = slot.key; c.curSpot = slot.spot; c.doing = slot.doing; c.place = sp.name; c.city = sp.city;
  p.route = null;
  if (slot.pose === "run" || slot.pose === "jog") {
    p.state = "walk"; p.roam = true; p.walk = slot.pose === "jog" ? (c.def.jogSpeed || 2.6) : c.def.walkSpeed;
  } else {
    p.state = "work"; p.pose = slot.pose; p.roam = false;
    p.side = sp.side; p.dir = 1; p.lat = 0.55;
    // face the road (vendors, buskers…) or the buildings / square behind
    const q = pathAt(p.e, p.s, {}), s = sp.side;
    p.faceYaw = sp.faceRoad ? Math.atan2(-q.tz * s, q.tx * s) : Math.atan2(q.tz * s, -q.tx * s);
  }
  setItems(c);
}
function putAt(c, slot) {
  const p = c.p, sp = SPOTS[slot.spot];
  p.e = sp.e; p.s = targetS(c, sp); p.dir = 1; p.side = sp.side; p.lat = 0.55;
  p.root.setEnabled(true); p.route = null; p.state = "walk";
  placePed(p);
  arrive(c, slot);
}
function hide(c) {
  const p = c.p;
  p.state = "away"; p.root.setEnabled(false); p.x = p.z = 1e6; p.route = null;
  c.slotKey = null;
  hideEl(c.tagEl); hideEl(c.bubEl);
}

const BUSY = new Set(["down", "flee", "cower", "surrender", "dodge", "annoyed", "watch", "talk"]);
function schedule(c, ctx) {
  const p = c.p;
  if (c.gone) { if (p.state !== "away") hide(c); return; }       // out of the story for good
  if (c.scripted) return;                                         // a mission is driving them
  if (c.hold > 0 || (convo && convo.c === c)) return;
  const slot = slotOf(c, hourNow());
  const pd = dist2(p.x, p.z, ctx.pos.x, ctx.pos.z);
  if (slot.spot === "home") {
    if (p.state !== "away" && pd > 70 && !BUSY.has(p.state)) hide(c);
    return;
  }
  const sp = SPOTS[slot.spot];
  const [sx, sz] = spotXZ(sp, targetS(c, sp));
  const spd = dist2(sx, sz, ctx.pos.x, ctx.pos.z);
  if (p.state === "away") { if (spd > 50) putAt(c, slot); return; }
  if (BUSY.has(p.state)) return;
  if (c.sulk > 0) { c.sulking = true; return; }
  if (c.sulking) { c.sulking = false; p.roam = false; p.replan = true; c.slotKey = null; if (p.state === "work") p.state = "walk"; }
  // far from where they should be, and nobody's watching: just be there
  const cd = dist2(p.x, p.z, sx, sz);
  if (cd > 90 && pd > 80 && spd > 60) { putAt(c, slot); return; }
  if (p.state === "work") {
    if (c.slotKey === slot.key) return;
    if (c.curSpot === slot.spot && cd < 4) { arrive(c, slot); return; }   // same spot, new activity
    p.state = "walk"; p.walk = c.def.walkSpeed; p.replan = true; setItems(c);
  }
  if (p.state === "walk") {
    if (p.roam) { if (c.slotKey === slot.key) return; p.roam = false; p.replan = true; }
    p.walk = c.def.walkSpeed;
    const ts = targetS(c, sp);
    if (p.e === sp.e) {
      p.route = [];
      p.dir = ts >= p.s ? 1 : -1;
      if (Math.abs(p.s - ts) < 1.1) { arrive(c, slot); return; }
    } else if (p.replan || !p.route || !p.route.length) { planRoute(c, sp, ts); p.replan = false; }
  }
}

// ================================================================ moods, needs, words
function band(c) {
  const a = c.mem.att;
  return a <= -5 ? "hostile" : a <= -2 ? "cold" : a < 2 ? "neutral" : a < 5 ? "friendly" : "trusted";
}
const BAND_LABEL = { hostile: "Hostile", cold: "Cold", neutral: "Stranger", friendly: "Friendly", trusted: "Trusts you" };
function mood(c) {
  if (c.fear > 0.4) return "scared";
  const a = c.mem.att;
  if (a <= -5) return "angry";
  if (a <= -2) return "wary";
  if (c.need.hunger > 0.75 || c.need.energy < 0.2) return c.def.persona.temper > 0.5 ? "irritated" : "tired";
  if (a >= 4) return "happy";
  return "neutral";
}
const POSE_EMO = { irritated: "wary", tired: "sad" };
const you = (c) => { const b = band(c); return c.def.addr[b === "hostile" || b === "cold" ? "hostile" : b === "neutral" ? "neutral" : "friend"]; };
function timeWords(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  if (hh === 0 && mm < 15) return "midnight";
  const h12 = hh % 12 || 12;
  const part = hh < 5 ? "in the middle of the night" : hh < 12 ? "in the morning" : hh < 17 ? "in the afternoon" : hh < 21 ? "in the evening" : "at night";
  return mm < 15 ? `${h12} ${part}` : mm < 45 ? `half ${h12} ${part}` : `nearly ${(h12 % 12) + 1} ${part}`;
}
const LOWER_OK = new Set(["The", "That", "This", "It", "It's", "There", "They", "He", "She", "You", "We", "What", "Why", "Every", "My", "Not", "No", "Yeah", "Maybe", "Some", "Don't", "Do", "Is", "Are", "Just", "Two", "One", "Business", "Same", "Long"]);
function voice(c, line, emo) {
  let s = line.replace(/\{you\}/g, you(c)).replace(/\{time\}/g, timeWords(hourNow())).replace(/\{place\}/g, c.place || "here");
  const q = c.def.quirk;
  if (R() < 0.3 && q.pre.length) {
    const pre = pick(q.pre), first = s.split(/[ ,.!?]/)[0];
    if (!s.startsWith(pre.trim())) s = pre + (LOWER_OK.has(first) ? s[0].toLowerCase() + s.slice(1) : s);
  }
  if (R() < 0.25 && q.post.length) { const post = pick(q.post); if (post && /[.!]$/.test(s)) s = s.replace(/[.!]+$/, "") + post; }
  if (emo === "scared") s = s.replace(/^(\w+)/, "$1— $1");
  else if ((emo === "tired" || c.need.energy < 0.25) && R() < 0.5) s = s.replace(/[.!]$/, "...");
  return s;
}
const out = (dialogue, emotion = "neutral", action = "none", att = 0, extra = {}) => ({ dialogue, emotion, action, att, ...extra });

// ================================================================ the response engine
function respond(c, intent, arg) {
  const d = c.def, m = c.mem, b = band(c), md = mood(c), h = hourNow(), night = h < 5 || h >= 23;
  const emo = (x) => x || (md === "scared" ? "scared" : md === "angry" ? "angry" : md === "wary" || md === "irritated" ? "wary" : md === "tired" ? "sad" : md === "happy" ? "happy" : "neutral");
  switch (intent) {
    case "greet": {
      m.lastTalkPrev = m.lastTalk; m.lastTalk = save.clock;
      if (m.hurt > 0 && save.clock - m.hurtAt < 24) {
        if (d.persona.brave > 0.6) return out(pick(["You've got some nerve coming back here.", "You. After what you did? Unbelievable."]), "angry");
        return out(pick(["Get away from me! Help!", "No— no, stay back!"]), "scared", "flee");
      }
      if (m.heard) {
        const hv = m.heard; m.heard = null;
        const line = hv.what === "hurt" ? `I heard what you did to ${hv.victim}. Hurt them. What's wrong with you?` : `${hv.victim} told me you threatened them. That true?`;
        return out(line, "wary");
      }
      if (b === "hostile") return out(pick(d.greet.hostile), "angry", d.persona.temper > 0.6 ? "walk_away" : "none");
      let line;
      if (!m.met) line = pick(d.greet.first);
      else if (b === "friendly" || b === "trusted") line = pick(d.greet.friend);
      else line = pick(d.greet.again);
      if (m.met && save.clock - (m.lastTalkPrev ?? -99) > 48) line = pick(["Haven't seen you around in a while. ", "Huh. Thought you'd skipped town. "]) + line;
      if (c.p.prevPose && ["phone", "busk", "paint", "vendor", "serve"].includes(c.p.prevPose) && R() < 0.35) line = pick(d.greet.busy) + " " + line;
      if (night && R() < 0.5) line += " " + pick([`It's ${timeWords(h)}, what are you doing out?`, "Bit late to be wandering, isn't it?"]);
      m.met++;
      return out(line, emo());
    }
    case "small": {
      const parts = [];
      convo.small = (convo.small || 0) + 1;
      if (convo.small > 3) return out(pick(["You're really just gonna keep asking me that?", "Same as five seconds ago.", "...Still fine. Still busy."]), "wary", "none", -0.5);
      if (c.event && save.clock - c.event.t < 3) parts.push(pick([`Did you hear that earlier? ${c.event.what}, over by ${c.event.where}.`, `${c.event.what} near ${c.event.where}. My hands are still shaking.`]));
      if (lastCtx && lastCtx.armed) parts.push(pick(["And put that thing away.", "You always carry that around?"]));
      if (c.need.hunger > 0.65 && d.needs.hungry.length) parts.push(pick(d.needs.hungry));
      else if (c.need.energy < 0.3 && d.needs.tired.length) parts.push(pick(d.needs.tired));
      else if (d.needs.broke.length && R() < 0.3) parts.push(pick(d.needs.broke));
      if (parts.length < 2) parts.push(pick(d.small[c.p.prevPose] || d.small[c.p.pose] || d.small.any));
      if (night && R() < 0.4) parts.push(`It's ${timeWords(h)}. Normal people are asleep.`);
      const gain = convo.small <= 2 && m.att > -2 ? 0.5 : 0;
      return out(parts.slice(0, 2).join(" "), emo(), "none", gain);
    }
    case "rumor": {
      if (b === "hostile" || b === "cold") return out(pick(["Why would I tell you anything?", "Ask someone who likes you."]), "wary");
      const r = d.rumors[m.rumor];
      if (!r) return out(pick(["That's all I've got.", "No idea. Honestly.", "Dunno. Ask around.", "Nothing new. It's a quiet town. Ha."]), emo());
      if (m.att < r.need) return out(pick(["Maybe if I knew you better.", "I don't really know you, do I?", "Hm. Not today."]), "wary");
      m.rumor++;
      return out(r.t, emo(r.need >= 3 ? "wary" : null));
    }
    case "personal": {
      const bio = d.bio[m.bio];
      if (!bio) return out(pick(["That's about it. Not much of a story.", "You know more than most people now."]), emo());
      if (m.att < bio.need) return out(pick(d.deflect), "wary");
      m.bio++; m.known = true;
      const deep = bio.need >= 4;
      return out(bio.t, deep ? "sad" : emo(), "none", deep ? 1 : 0);
    }
    case "about": {
      const o = byId[arg];
      if (b === "hostile") return out("I'm not gossiping with you.", "angry");
      let line = d.opinions[arg] || "Who? Never heard of them.";
      if (o && o.p.state !== "away" && o.city && (o.city === c.city || d.friends.includes(arg)) && R() < 0.65) {
        line += " " + pick([`Saw them ${o.doing} by ${o.place} earlier.`, `Pretty sure they're ${o.doing} over at ${o.place}.`]);
      }
      if (o && o.mem.att <= -5 && d.friends.includes(arg)) line += " And they've told me about you.";
      return out(line, emo());
    }
    case "favor": {
      const f = d.favor, st = save.favors[d.id] || "none";
      if (st === "given") return out(f.remind, emo());
      if (st === "delivered") {
        save.favors[d.id] = "rewarded";
        return out(f.thanks, "happy", "none", f.reward.att, { cash: f.reward.cash });
      }
      if (st === "rewarded") return out(pick(["You've done plenty. Really.", "Nah, we're good. Thanks though."]), emo());
      if (m.att < f.need || b === "cold" || b === "hostile") return out(pick(["From you? No.", "I'm fine. Thanks.", ...d.deflect]), "wary");
      save.favors[d.id] = "given";
      return out(f.ask, emo("neutral"));
    }
    case "deliver": {
      const giver = byId[arg], rec = d.receives[arg];
      save.favors[arg] = "delivered";
      if (!rec) return out("Huh. Okay.", "neutral");
      return out(rec.say, rec.emo, "none", rec.att);
    }
    case "gift": {
      const g = d.gift;
      m.gifts++;
      const k = m.gifts > 2 ? 0.3 : 1;
      if (!g.takes) return out(pick(g.refuse), "happy", "none", g.att * k);
      return out(m.gifts > 3 ? "You keep doing this. ...Thanks? Weirdo." : pick(g.accept), "happy", "none", g.att * k, { pay: 20 });
    }
    case "threaten": {
      m.threatened++;
      gossip(c, "threatened");
      const a = d.threat.action;
      return out(pick(d.threat.lines), a === "flee" ? "scared" : "angry", a, -3);
    }
    case "bye": {
      const k = b === "hostile" || b === "cold" ? "hostile" : b === "neutral" ? "neutral" : "friend";
      return out(pick(d.bye[k]), emo(), "leave");
    }
  }
  return out("...", "neutral");
}
function gossip(c, what) {
  for (const f of c.def.friends) {
    const o = byId[f];
    if (!o) continue;
    o.mem.att = clamp(o.mem.att - 1, -10, 10);
    o.mem.heard = { victim: c.def.short, what };
  }
  persist();
}

// ================================================================ street reactions → memory
function bubble(c, text, secs = 3.8) { c.bubble = { text, t: secs }; }
function onHurt(c) {
  const m = c.mem;
  m.hurt++; m.hurtAt = save.clock; m.att = clamp(m.att - 4, -10, 10);
  gossip(c, "hurt");
  c.fear = 1;
  c.event = { t: save.clock, what: "Somebody attacked me", where: c.place || "here" };
  bubble(c, pick(["Ow! Are you insane?!", "AAH! Help!", "What is WRONG with you?!"]), 3);
  if (convo && convo.c === c) endConvo(true);
}
function onGun(c) {
  if (save.clock - c.mem.gunAt < 0.5) return;
  c.mem.gunAt = save.clock; c.mem.att = clamp(c.mem.att - 1, -10, 10);
  c.fear = Math.max(c.fear, 0.7);
  bubble(c, c.def.persona.brave > 0.8 ? pick(["Point that somewhere else.", "You won't."]) : pick(["Whoa — okay — okay!", "Don't shoot! Please!"]), 2.5);
  if (convo && convo.c === c) endConvo(true);
  persist();
}
function onScare(c, x, z, rel) {
  c.fear = Math.max(c.fear, rel < 0.6 ? 0.9 : 0.5);
  c.event = { t: save.clock, what: rel < 0.6 ? "Gunshots" : "A lot of noise", where: c.place || "the street" };
  if (rel < 0.6) bubble(c, pick(["What was that?!", "Was that a gun?!", "Get down!"]), 2.2);
}
function onBarged(c) {
  c.mem.att = clamp(c.mem.att - 0.5, -10, 10);
  bubble(c, pick(["Hey! Watch it!", "Excuse YOU.", "Seriously?", ...c.def.barks.hostile]), 2.5);
  persist();
}

// ================================================================ conversation
function openConvo(c) {
  const p = c.p;
  p.prevPose = p.state === "work" ? p.pose : null;
  convo = { c, sub: null, small: 0, closeAt: 0, playerLine: "" };
  p.state = "talk"; p.route = null;
  c.bubble = null;
  setItems(c);
  apply(c, respond(c, "greet"));
}
function endConvo(silent = false) {
  if (!convo) return;
  const c = convo.c;
  convo = null;
  panel.style.display = "none";
  c.hold = 0;
  if (c.p.state === "talk") {
    c.p.state = "walk"; c.p.replan = true;
    if (c.p.prevPose) { c.p.state = "work"; c.p.pose = c.p.prevPose; c.slotKey = null; }
  }
  setItems(c);
  persist();
}
function apply(c, r) {
  const m = c.mem;
  m.att = clamp(m.att + (r.att || 0), -10, 10);
  if (r.cash) save.wallet += r.cash;
  if (r.pay) save.wallet -= r.pay;
  c.p.emotion = POSE_EMO[r.emotion] || r.emotion;
  const line = voice(c, r.dialogue, r.emotion);
  convo.line = line; convo.shown = 0; convo.emo = r.emotion;
  convo.reward = r.cash ? `+$${r.cash}` : r.pay ? `−$${r.pay}` : "";
  persist();
  const act = r.action;
  if (act === "none") return;
  convo.ending = true;
  const c2 = c, ctx = lastCtx;
  const later = (s, fn) => { convo.closeAt = performance.now() + s * 1000; convo.after = fn; };
  if (act === "leave") later(1.6, () => {});
  else if (act === "walk_away") later(1.8, () => { c2.sulk = 40; c2.p.state = "walk"; c2.p.roam = true; c2.p.route = null; });
  else if (act === "flee") later(0.9, () => { fleePed(c2.p, ctx.pos.x, ctx.pos.z); c2.fear = 1; });
  else if (act === "attack") later(0.7, () => {
    const dx = ctx.pos.x - c2.p.x, dz = ctx.pos.z - c2.p.z, l = Math.hypot(dx, dz) || 1;
    if (ctx.shove) ctx.shove(dx / l, dz / l);
    c2.p.state = "annoyed"; c2.p.timer = 2.2; c2.sulk = 30;
  });
  else if (act === "phone") later(1.6, () => { c2.p.state = "work"; c2.p.pose = "phone"; c2.hold = 10; c2.slotKey = null; setItems(c2); bubble(c2, pick(["Yes, hello? There's someone here—", "Police? Yes. Yes, I'll hold."]), 4); });
}
function choices(c) {
  const d = c.def, m = c.mem;
  if (convo.sub === "story") return storyLines(c);
  // mission characters: the mission, and goodbye — nothing else
  if (MISSION_CAST.has(d.id)) return [...storyLines(c), { label: "Goodbye.", go: () => say(c, "bye", null, "Goodbye.") }];
  if (convo.sub === "people") {
    const known = Object.keys(d.opinions).filter((id) => byId[id]);
    return [
      ...known.map((id) => ({ label: byId[id].mem.known ? byId[id].def.short : `the ${byId[id].def.role.toLowerCase().replace(/[“”]/g, "")}`, go: () => say(c, "about", id, `What do you think of ${byId[id].mem.known ? byId[id].def.short : "the " + byId[id].def.role.toLowerCase().replace(/[“”]/g, "")}?`) })),
      { label: "Never mind.", go: () => { convo.sub = null; } },
    ];
  }
  const list = [
    // mission lines come first when the story has something to say here
    ...(storyHooks.choices ? storyHooks.choices(c) : []),
    { label: "How's it going?", go: () => say(c, "small", null, "How's it going?") },
    { label: "Heard anything interesting?", go: () => say(c, "rumor", null, "Heard anything interesting?") },
    { label: "Tell me about yourself.", go: () => say(c, "personal", null, "Tell me about yourself.") },
    { label: "What do you think of…", go: () => { convo.sub = "people"; } },
  ];
  const st = save.favors[d.id] || "none";
  const fl = st === "none" ? "Need a hand with anything?" : st === "given" ? "About that favour…" : st === "delivered" ? "I passed your message on." : null;
  if (fl) list.push({ label: fl, go: () => say(c, "favor", null, fl) });
  for (const g of CAST) {
    if (g.favor.target === d.id && save.favors[g.id] === "given") {
      const gn = byId[g.id].mem.known ? g.short : `the ${g.role.toLowerCase().replace(/[“”]/g, "")}`;
      list.push({ label: `I've got a message from ${gn}.`, go: () => say(c, "deliver", g.id, `I've got a message for you, from ${gn}.`) });
    }
  }
  list.push({ label: `Here, have $20.`, note: `you have $${save.wallet}`, off: save.wallet < 20, go: () => say(c, "gift", null, "Here, have twenty.") });
  list.push({ label: "Hand over your cash. Now.", go: () => say(c, "threaten", null, "Hand over your cash. Now.") });
  list.push({ label: "See you around.", go: () => say(c, "bye", null, "See you around.") });
  return list;
}
function say(c, intent, arg, playerLine) {
  convo.sub = null;
  convo.playerLine = playerLine;
  apply(c, respond(c, intent, arg));
}
function choose(n) {
  if (!convo || convo.ending) return;
  const list = choices(convo.c);
  const o = list[n - 1];
  if (!o || o.off) return;
  if (convo.shown < (convo.line || "").length) { convo.shown = convo.line.length; }
  o.go();
  renderPanel(true);
}
function onKey(e) {
  if (e.repeat) return;
  if (convo) {
    if (e.code === "Escape" || e.code === "KeyT") { if (!convo.ending) say(convo.c, "bye", null, "See you around."); renderPanel(true); return; }
    const mm = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (mm) choose(+mm[1]);
    return;
  }
  if (e.code === "KeyT" && candidate) openConvo(candidate);
}
export const inConversation = () => !!convo;

// ---------------------------------------------------------------- story / mission hooks
// storyHooks.choices(c) → extra dialogue options [{ label, go }] for character c
export const storyHooks = { choices: null };
export const charById = (id) => byId[id];
// Say a scripted line as character c in the open conversation.
export function speakAs(c, dialogue, emotion = "neutral", playerLine = "", action = "none") {
  if (!convo || convo.c !== c) return;
  convo.sub = null;
  convo.playerLine = playerLine;
  apply(c, out(dialogue, emotion, action));
}
export function addCash(n) { save.wallet += n; persist(); }
export const wallet = () => save.wallet;
export function setGone(id) { const c = byId[id]; if (c) { c.gone = true; c.scripted = false; } }
// ...and back into the world (the story is done with them)
export function setBack(id) { const c = byId[id]; if (c) c.gone = false; }
export function endConversation() { if (convo) endConvo(); }
// For the maps: where the story characters are right now (not those at home).
export function characterMarkers() {
  const out = [];
  for (const c of chars) {
    if (c.p.state === "away" || c.p.dead) continue;
    out.push({ x: c.p.x, z: c.p.z, label: c.mem.known ? c.def.short : c.def.role });
  }
  return out;
}
export function talkPrompt() {
  if (!candidate) return "";
  const n = candidate.mem.known ? candidate.def.short : candidate.def.role;
  return candidate.sulk > 0 ? `${n} isn't talking to you` : `<kbd>T</kbd> Talk to ${n}`;
}

// ================================================================ UI
let ui, panel;
function injectUI() {
  const css = document.createElement("style");
  css.textContent = `
  #chrUI{position:fixed;inset:0;pointer-events:none;z-index:30;font-family:"Segoe UI",system-ui,sans-serif}
  .chrTag{position:absolute;transform:translate(-50%,-100%);color:#fff;font-size:12px;font-weight:600;text-shadow:0 1px 3px #000;white-space:nowrap;display:none}
  .chrTag small{display:block;font-weight:400;opacity:.8;font-size:11px;text-align:center}
  .chrBub{position:absolute;transform:translate(-50%,-100%);max-width:240px;background:#fffdf6;color:#1c1c1c;padding:6px 10px;border-radius:10px;font-size:13px;line-height:1.3;box-shadow:0 3px 10px rgba(0,0,0,.35);display:none}
  .chrBub:after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-top-color:#fffdf6;border-bottom:0}
  #chrTalk{position:fixed;left:50%;bottom:118px;transform:translateX(-50%);width:min(640px,calc(100vw - 32px));background:rgba(16,18,24,.9);color:#eee;border-radius:12px;padding:14px 18px 12px;z-index:40;display:none;font-family:"Segoe UI",system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)}
  #chrTalk .hd{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  #chrTalk .nm{font-size:18px;font-weight:800;color:#ffd36b}
  #chrTalk .rl{font-size:13px;opacity:.75}
  #chrTalk .chip{font-size:11px;padding:2px 8px;border-radius:99px;background:#2c3140;text-transform:uppercase;letter-spacing:.5px}
  #chrTalk .st{font-size:12px;opacity:.6;margin:4px 0 8px}
  #chrTalk .you{font-size:13px;color:#9fc4ff;margin-bottom:4px;font-style:italic}
  #chrTalk .ln{font-size:16px;line-height:1.45;min-height:46px}
  #chrTalk .rw{color:#7ee3a1;font-weight:700;margin-left:6px}
  #chrTalk ol{margin:10px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:13.5px}
  #chrTalk li{opacity:.92}
  #chrTalk li.off{opacity:.35}
  #chrTalk li kbd{display:inline-block;min-width:18px;padding:0 5px;margin-right:6px;border-radius:4px;background:#eee;color:#222;font:600 12px/18px monospace;text-align:center}
  #chrTalk li small{opacity:.55;margin-left:4px}
  #chrTalk .ft{margin-top:8px;font-size:11.5px;opacity:.5;text-align:right}
  @media (max-width:560px){#chrTalk ol{grid-template-columns:1fr}}`;
  document.head.appendChild(css);
  ui = document.createElement("div"); ui.id = "chrUI"; document.body.appendChild(ui);
  panel = document.createElement("div"); panel.id = "chrTalk"; document.body.appendChild(panel);
}
function makeTagEls(c) {
  c.tagEl = document.createElement("div"); c.tagEl.className = "chrTag"; ui.appendChild(c.tagEl);
  c.bubEl = document.createElement("div"); c.bubEl.className = "chrBub"; ui.appendChild(c.bubEl);
}
const hideEl = (el) => { if (el && el.style.display !== "none") el.style.display = "none"; };
const EMO_COL = { angry: "#b8323a", scared: "#7a4fb8", wary: "#8a6a2a", sad: "#3c5a8a", happy: "#2f7d4a", amused: "#2f7d6d", irritated: "#9a5a2a", tired: "#4a5262", neutral: "#2c3140" };
function renderPanel(force = false) {
  if (!convo) return;
  const c = convo.c, d = c.def, n = c.mem.known ? d.name : "???";
  const md = convo.emo || mood(c);
  const needs = [c.need.hunger > 0.6 ? "hungry" : "", c.need.energy < 0.3 ? "exhausted" : "", c.fear > 0.4 ? "shaken" : ""].filter(Boolean).join(", ");
  const status = `${c.doing ? c.doing[0].toUpperCase() + c.doing.slice(1) : "Out and about"} · ${c.place || ""} · ${timeWords(hourNow())}${needs ? " · " + needs : ""}`;
  const text = convo.line.slice(0, Math.floor(convo.shown));
  const opts = convo.ending ? "" : `<ol>${choices(c).map((o, i) => `<li class="${o.off ? "off" : ""}"><kbd>${i + 1}</kbd>${o.label}${o.note ? `<small>(${o.note})</small>` : ""}</li>`).join("")}</ol>`;
  const html = `<div class="hd"><span class="nm">${n}</span><span class="rl">${d.role}${c.mem.known ? ", " + d.age : ""}</span>
    <span class="chip" style="background:${EMO_COL[md] || EMO_COL.neutral}">${md}</span><span class="chip">${BAND_LABEL[band(c)]}</span></div>
    <div class="st">${status}</div>${convo.playerLine ? `<div class="you">You: “${convo.playerLine}”</div>` : ""}
    <div class="ln">${text}${convo.shown >= convo.line.length && convo.reward ? `<span class="rw">${convo.reward}</span>` : ""}</div>${opts}
    <div class="ft">Wallet $${save.wallet} · met ${c.mem.met}× · <kbd style="background:#eee;color:#222;border-radius:3px;padding:0 4px">T</kbd>/<kbd style="background:#eee;color:#222;border-radius:3px;padding:0 4px">Esc</kbd> leave</div>`;
  if (force || panel.__html !== html) { panel.innerHTML = html; panel.__html = html; }
  panel.style.display = "block";
}
const TMP = new V(0, 0, 0);
function project(x, y, z) {
  TMP.set(x, y, z);
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const v = V.Project(TMP, BABYLON.Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  if (v.z < 0 || v.z > 1) return null;
  const k = canvas.clientWidth / w;
  return [v.x * k, v.y * (canvas.clientHeight / h)];
}
function placeEl(el, xy, html) {
  if (!xy) { hideEl(el); return; }
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
  el.style.display = "block";
  el.style.left = xy[0] + "px"; el.style.top = xy[1] + "px";
}
export function hideCharacterUI() {
  for (const c of chars) { hideEl(c.tagEl); hideEl(c.bubEl); }
  if (convo) endConvo(true);
}

// ================================================================ per-frame
let pairTimer = 0;
// ctx: { pos, vehicle, armed, shove(dx, dz) }
export function updateCharacters(dt, hour, ctx) {
  lastCtx = ctx;
  // follow the game's time of day; count elapsed hours (time skips count too)
  if (lastHour === null) lastHour = hour;
  const dh = ((hour - lastHour) % 24 + 24) % 24;
  lastHour = hour; curHour = hour;
  save.clock += dh;
  const onFoot = !ctx.vehicle && ctx.pos.y - terrainH(ctx.pos.x, ctx.pos.z) < 2.5;

  candidate = null;
  let bestD = 2.8;
  for (const c of chars) {
    const p = c.p, d = c.def, slot = slotOf(c, hourNow());
    // needs drift with game time
    const away = p.state === "away";
    c.need.hunger = clamp(c.need.hunger + dh * (away ? 0.02 : p.pose === "eat" && p.state === "work" ? -0.5 : 0.06), 0, 1);
    c.need.energy = clamp(c.need.energy + dh * (away ? 0.14 : p.pose === "sleep" ? 0.1 : -0.04), 0, 1);
    c.fear = Math.max(0, c.fear - dt * 0.05);
    c.sulk = Math.max(0, c.sulk - dt);
    c.hold = Math.max(0, c.hold - dt);
    c.barkCool -= dt;
    if (c.bubble) { c.bubble.t -= dt; if (c.bubble.t <= 0) c.bubble = null; }
    schedule(c, ctx);
    if (p.state === "away") continue;
    if (p.state === "walk" && !p.roam && slot.spot !== "home") c.doing = "on the way to " + SPOTS[slot.spot].name;

    const pd = dist2(p.x, p.z, ctx.pos.x, ctx.pos.z);
    // who can we talk to? (not someone running, hurt, or fast asleep)
    if (onFoot && !convo && !c.scripted && !p.dead && pd < bestD && storyLines(c).length && !["down", "flee", "cower", "surrender", "dodge", "away"].includes(p.state) && !(p.state === "work" && p.pose === "sleep")) { bestD = pd; candidate = c; }
    // barks as you pass
    if (onFoot && !convo && pd < 7 && c.barkCool <= 0 && (p.state === "work" || p.state === "walk")) {
      c.barkCool = 22 + R() * 18;
      const b = band(c);
      let pool = d.barks.work;
      if (ctx.armed) pool = ["Whoa — easy with that!", "Is that a gun?", "Don't point that at me."];
      else if (b === "hostile" || b === "cold") pool = d.barks.hostile.length ? d.barks.hostile : pool;
      else if ((b === "friendly" || b === "trusted") && R() < 0.6) pool = d.barks.friendly;
      else if ((hourNow() >= 21 || hourNow() < 5) && d.barks.night.length && R() < 0.4) pool = d.barks.night;
      if (pool.length && (pd < 4 || R() < 0.6)) bubble(c, pick(pool));
    }
    // tag + bubble on screen
    const show = pd < 22 && !(convo && convo.c === c);
    const top = terrainH(p.x, p.z) + 2.15 - p.crouch * 0.6;
    if (show) placeEl(c.tagEl, project(p.x, top + 0.15, p.z), `${c.mem.known ? d.short : "?"}<small>${d.role}</small>`);
    else hideEl(c.tagEl);
    if (c.bubble && pd < 30) placeEl(c.bubEl, project(p.x, top + 0.55, p.z), c.bubble.text);
    else hideEl(c.bubEl);
  }

  // characters who share a spot talk to each other now and then
  pairTimer -= dt;
  if (pairTimer <= 0) {
    pairTimer = 6;
    for (const a of chars) {
      if (a.p.state !== "work" || a.bubble || R() > 0.35) continue;
      for (const b of chars) {
        if (b === a || b.p.state !== "work" || !a.def.vs[b.def.id]) continue;
        if (dist2(a.p.x, a.p.z, b.p.x, b.p.z) > 9 || dist2(a.p.x, a.p.z, ctx.pos.x, ctx.pos.z) > 40) continue;
        bubble(a, a.def.vs[b.def.id], 3.5);
        if (b.def.vs[a.def.id]) setTimeout(() => { if (!b.bubble) bubble(b, b.def.vs[a.def.id], 3.5); }, 2200);
        break;
      }
    }
  }

  // conversation upkeep
  if (convo) {
    const c = convo.c, p = c.p;
    const pd = dist2(p.x, p.z, ctx.pos.x, ctx.pos.z);
    if (!convo.ending && (pd > 5 || ctx.vehicle || p.state !== "talk")) {
      if (p.state === "talk" && pd > 5) bubble(c, pick(["...Rude.", "Okay, bye then.", "And they're gone."]), 2.5);
      endConvo();
    } else {
      convo.shown = Math.min(convo.line.length, convo.shown + dt * 55);
      if (convo.ending && convo.closeAt && performance.now() > convo.closeAt) {
        const fn = convo.after;
        endConvo();
        if (fn) fn();
      } else renderPanel();
    }
  }
  flushSave(dt);
}
