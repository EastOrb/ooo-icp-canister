import {
  $query,
  $update,
  Record,
  StableBTreeMap,
  Vec,
  match,
  Result,
  nat64,
  ic,
  Opt,
} from "azle";
import { v4 as uuidv4, validate as isValidUUID } from "uuid";

// Constants
const DEFAULT_AVAILABLE_DAYS = 21;

enum LeaveStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

// User Record Type
type User = Record<{
  id: string;
  name: string;
  email: string;
  availableDays: number;
  createdAt: nat64;
  updatedAt: Opt<nat64>;
}>;

// User Payload Type
type UserPayload = Record<{
  name: string;
  email: string;
  availableDays?: number;
}>;

// Leave Record Type
type Leave = Record<{
  id: string;
  userId: string;
  startDate: number;
  endDate: number;
  days: number;
  status: LeaveStatus;
  createdAt: nat64;
  updatedAt: Opt<nat64>;
}>;

// Leave Payload Type
type LeavePayload = Record<{
  startDate: number;
  endDate: number;
}>;

// Storages
const leaveStorage = new StableBTreeMap<string, Leave>(0, 44, 1024);
const userStorage = new StableBTreeMap<string, User>(1, 44, 1024);

// ========================= USER MANAGEMENT ===================================

/**
 * Get a user by ID.
 * @param id User ID
 * @returns Result<User, string>
 */
$query;
export function getUser(id: string): Result<User, string> {
  if (!isValidUUID(id)) {
    return Result.Err<User, string>("Please enter a valid User ID!");
  }

  return match(userStorage.get(id), {
    Some: (userData) => Result.Ok<User, string>(userData),
    None: () => Result.Err<User, string>(`User with ID ${id} not found!`),
  });
}

/**
 * Get all users.
 * @returns Result<Vec<User>, string>
 */
$query;
export function getUsers(): Result<Vec<User>, string> {
  return Result.Ok<Vec<User>, string>(userStorage.values());
}

/**
 * Add a new user.
 * @param payload UserPayload
 * @returns Result<User, string>
 */
$update;
export function addUser(payload: UserPayload): Result<User, string> {
  if (!payload.name || !payload.email) {
    return Result.Err("Name and Email are required. Please provide valid data.");
  }

  const users = userStorage.values();
  const isUserExists = users.find((user) => user.email === payload.email);

  if (isUserExists) {
    return Result.Err<User, string>("User with this email already exists!");
  }

  const availableDays = payload.availableDays ?? DEFAULT_AVAILABLE_DAYS;
  
  const user: User = {
    id: uuidv4(),
    createdAt: ic.time(),
    updatedAt: Opt.None,
    ...payload,
    availableDays,
  };

  userStorage.insert(user.id, user);

  return Result.Ok<User, string>(user);
}

/**
 * Update user information.
 * @param id User ID
 * @param payload UserPayload
 * @returns Result<User, string>
 */
$update;
export function updateUser(id: string, payload: UserPayload): Result<User, string> {
  if (!isValidUUID(id)) {
    return Result.Err<User, string>("Please enter a valid User ID!");
  }

  if (!payload.name || !payload.email) {
    return Result.Err("Name and Email cannot be empty. Please provide valid data.");
  }

  return match(userStorage.get(id), {
    Some: (user) => {
      const updatedUser: User = {
        ...user,
        ...payload,
        updatedAt: Opt.Some(ic.time()),
      };

      userStorage.insert(user.id, updatedUser);

      return Result.Ok<User, string>(updatedUser);
    },
    None: () => Result.Err<User, string>(`User with ID ${id} not found!`),
  });
}

/**
 * Delete a user by ID.
 * @param id User ID
 * @returns Result<User, string>
 */
$update;
export function deleteUser(id: string): Result<User, string> {
  if (!isValidUUID(id)) {
    return Result.Err<User, string>("Please enter a valid User ID!");
  }

  return match(userStorage.remove(id), {
    Some: (deletedUser) => Result.Ok<User, string>(deletedUser),
    None: () => Result.Err<User, string>(`User with ID ${id} not found!`),
  });
}

// ========================= LEAVE MANAGEMENT ==================================

/**
 * Get all leave requests.
 * @returns Result<Vec<Leave>, string>
 */
$query;
export function getLeaveRequests(): Result<Vec<Leave>, string> {
  return Result.Ok<Vec<Leave>, string>(leaveStorage.values());
}

/**
 * Get leave requests for a specific user.
 * @param userId User ID
 * @returns Result<Vec<Leave>, string>
 */
$query;
export function getUsersLeaveRequests(userId: string): Result<Vec<Leave>, string> {
  if (!isValidUUID(userId)) {
    return Result.Err("Please enter a valid User ID!");
  }

  return Result.Ok(leaveStorage.values().filter(({ userId }) => userId === userId));
}

/**
 * Get leave requests by status.
 * @param status Leave status (PENDING, APPROVED, or REJECTED)
 * @returns Result<Vec<Leave>, string>
 */
$query;
export function getLeaveRequestsByStatus(status: LeaveStatus): Result<Vec<Leave>, string> {
  if (!Object.values(LeaveStatus).includes(status)) {
    return Result.Err("Please enter a valid status (PENDING, APPROVED, or REJECTED).");
  }

  return Result.Ok(leaveStorage.values().filter((leave) => leave.status === status));
}

/**
 * Request leave for a user.
 * @param userId User ID
 * @param payload LeavePayload
 * @returns Result<Leave, string>
 */
$update;
export function requestLeave(userId: string, payload: LeavePayload): Result<Leave, string> {
  if (!isValidUUID(userId)) {
    return Result.Err("Please enter a valid User ID!");
  }

  const user = getUser(userId);

  if (!user.Ok || user.Err) {
    return Result.Err<Leave, string>("User with the given ID was not found.");
  }

  const { startDate, endDate } = payload;

  if (startDate >= endDate) {
    return Result.Err("Start date must be before end date.");
  }

  const currentYear = new Date().getFullYear();
  const startDateObject = new Date(startDate);
  const endDateObject = new Date(endDate);

  if (
    startDateObject.getFullYear() !== currentYear ||
    endDateObject.getFullYear() !== currentYear
  ) {
    return Result.Err("Leave period should be in the current calendar year.");
  }

  const diffDays = findDiffInDays(payload.startDate, payload.endDate);

  if (diffDays < 1) {
    return Result.Err("
Leave should be at least one day.");
  }

  // Check if user has enough available days left
  if (user.Ok.availableDays < diffDays) {
    return Result.Err("You are exceeding your available days for leave.");
  }

  // Check for overlapping leave periods
  const leaves = leaveStorage
    .values()
    .filter((leave) => leave.userId === userId);

  const isOverlapping = leaves.some((currentLeave) =>
    !(endDate < currentLeave.startDate || startDate > currentLeave.endDate)
  );

  if (isOverlapping) {
    return Result.Err("The chosen leave period overlaps with an existing leave.");
  }

  const leave: Leave = {
    id: uuidv4(),
    userId,
    createdAt: ic.time(),
    updatedAt: Opt.None,
    status: LeaveStatus.PENDING,
    days: diffDays,
    ...payload,
  };

  leaveStorage.insert(leave.id, leave);

  updateUsersAvailableDays(userId, diffDays, "SUBTRACT");

  return Result.Ok(leave);
}

/**
 * Update leave information.
 * @param id Leave ID
 * @param payload LeavePayload
 * @returns Result<Leave, string>
 */
$update;
export function updateLeave(id: string, payload: LeavePayload): Result<Leave, string> {
  if (!isValidUUID(id)) {
    return Result.Err("Please enter a valid Leave ID!");
  }

  return match(leaveStorage.get(id), {
    Some: (leave) => {
      const diffDays = findDiffInDays(payload.startDate, payload.endDate);

      if (diffDays < 1) {
        return Result.Err<Leave, string>("Leave should be at least one day.");
      }

      const updatedLeave: Leave = {
        ...leave,
        ...payload,
        days: diffDays,
        updatedAt: Opt.Some(ic.time()),
      };

      leaveStorage.insert(leave.id, updatedLeave);

      return Result.Ok<Leave, string>(updatedLeave);
    },
    None: () => Result.Err<Leave, string>(`Leave with ID ${id} not found!`),
  });
}

/**
 * Delete leave by ID.
 * @param id Leave ID
 * @returns Result<Leave, string>
 */
$update;
export function deleteLeave(id: string): Result<Leave, string> {
  if (!isValidUUID(id)) {
    return Result.Err("Please enter a valid Leave ID!");
  }

  return match(leaveStorage.remove(id), {
    Some: (deletedLeave) => Result.Ok<Leave, string>(deletedLeave),
    None: () => Result.Err<Leave, string>(`Leave with ID ${id} not found!`),
  });
}

/**
 * Update leave status.
 * @param id Leave ID
 * @param status Leave status (PENDING, APPROVED, or REJECTED)
 * @returns Result<Leave, string>
 */
$update;
export function updateLeaveStatus(id: string, status: LeaveStatus): Result<Leave, string> {
  if (!isValidUUID(id)) {
    return Result.Err<Leave, string>("Please enter a valid Leave ID!");
  }

  return match(leaveStorage.get(id), {
    Some: (leave) => {
      const updatedLeave: Leave = {
        ...leave,
        status: status,
        updatedAt: Opt.Some(ic.time()),
      };

      leaveStorage.insert(leave.id, updatedLeave);

      if (status === LeaveStatus.REJECTED) {
        updateUsersAvailableDays(leave.userId, leave.days, "ADD");
      } else {
        updateUsersAvailableDays(leave.userId, leave.days, "SUBTRACT");
      }

      return Result.Ok<Leave, string>(updatedLeave);
    },
    None: () => Result.Err<Leave, string>(`Leave with ID ${id} not found!`),
  });
}

// ============================= HELPERS =======================================

/**
 * Update a user's available leave days.
 * @param userId User ID
 * @param leaveDays Leave days to add or subtract
 * @param operation "ADD" to add days, "SUBTRACT" to subtract days
 * @returns Result<User, string>
 */
function updateUsersAvailableDays(
  userId: string,
  leaveDays: number,
  operation: "ADD" | "SUBTRACT",
): Result<User, string> {
  if (!isValidUUID(userId)) {
    return Result.Err("Please enter a valid User ID!");
  }

  const user = getUser(userId);

  if (!user || !user.Ok || !user.Ok.availableDays) {
    return Result.Err(
      `Could not update the user's leave status. Something went wrong!`
    );
  }

  let availableDays = user.Ok.availableDays;
  if (operation === "ADD") {
    availableDays += leaveDays;
  } else if (operation === "SUBTRACT") {
    availableDays -= leaveDays;
  }

  return updateUser(userId, {
    ...user.Ok,
    availableDays,
  });
}

/**
 * Calculate the difference in days between two dates.
 * @param startDate Start date in milliseconds
 * @param endDate End date in milliseconds
 * @returns number
 */
function findDiffInDays(startDate: number, endDate: number): number {
  const oneDay = 24 * 60 * 60 * 1000; // hours * minutes * seconds * milliseconds
  const diffDays = Math.round(Math.abs((endDate - startDate) / oneDay));

  return Math.max(1, diffDays);
}

// A workaround to make the uuid package work with Azle
globalThis.crypto = {
  // @ts-ignore
  getRandomValues: () => {
    const array = new Uint8Array(32);

    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }

    return array;
  },
};
