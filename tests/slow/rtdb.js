// For the tests: what Firebase's Realtime Database does to a value written to it, so a game's room state can be checked
// without the database: it refuses the whole write for undefined, NaN or Infinity, a function, or a bad key; it keeps no
// nulls and no empty lists or objects; and it reads an object whose keys are all integers, more than half of them
// present, back as a list with holes. The rules live in memdb.js, which an offline party's host keeps its database by
// (tests/fake-sync.js does the same in a browser).
export { validate, roundTrip, same } from "./memdb.js";
