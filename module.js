import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "roomgrid",
  reference: 80,
  title: "RoomGrid",
  description:
    "Бронирование комнат с ограничением вместимости и проверкой пересечений во времени.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C("rooms", "Помещения", [
      F("name", "Комната"),
      F("capacity", "Вместимость", "integer", { min: 1, max: 1000 }),
    ]),
    C("bookings", "Бронирования", [
      R("room", "Комната", "rooms"),
      F("purpose", "Цель / код группы"),
      F("people", "Участников", "integer", { min: 1, max: 1000 }),
      F("start", "Начало", "datetime"),
      F("end", "Окончание", "datetime"),
      S("status", "Состояние", [
        ["booked", "Забронировано"],
        ["cancelled", "Отменено"],
      ]),
    ]),
  ],
  validate(state, before, command, actor) {
    unique(live(state, "rooms"), "name", "Комната");
    for (const b of rows(state, "bookings")) {
      interval(b.start, b.end);
      const room = byId(state, "rooms", b.room);
      required(b.people <= room.capacity, "Вместимость комнаты превышена.");
      if (b.status === "booked")
        required(
          !room.archived && !b.archived,
          "Для активной брони нужна действующая комната.",
        );
    }
    noOverlap(
      rows(state, "bookings"),
      "room",
      "start",
      "end",
      (x) => x.status === "booked",
    );
  },
  summarize(state) {
    return live(state, "rooms").map((r) =>
      summary(
        r.name + " · до " + r.capacity + " человек",
        ...rows(state, "bookings")
          .filter((x) => x.room === r.id && x.status === "booked")
          .map(
            (b) =>
              clock(b.start) +
              " → " +
              clock(b.end, b.start) +
              " · " +
              b.purpose,
          ),
      ),
    );
  },
};
export default definition;
