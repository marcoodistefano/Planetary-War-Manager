const ArmyState = Object.freeze({
    STANDBY: 'standby',
    MOVING: 'moving',
    ENGAGING: 'engaging',
    COMBAT: 'combat',
    RETREATING: 'retreating',
    RETURNING: 'returning',
    RESUPPLYING: 'resupplying',
    DESTROYED: 'destroyed'
});

const legacyStateMap = Object.freeze({
    standby: ArmyState.STANDBY,
    moving: ArmyState.MOVING,
    moving_to_border: ArmyState.MOVING,
    "Pronto alla conquista": ArmyState.MOVING,
    "Pronto all'attacco": ArmyState.ENGAGING,
    combattimento: ArmyState.COMBAT,
    'in combattimento': ArmyState.COMBAT,
    in_battaglia: ArmyState.COMBAT,
    retreating: ArmyState.RETREATING,
    returning: ArmyState.RETURNING,
    cooldown: ArmyState.RESUPPLYING,
    dead: ArmyState.DESTROYED,
    destroyed: ArmyState.DESTROYED
});

function normalizeArmyState(armyOrStatus) {
    const status = typeof armyOrStatus === 'string'
        ? armyOrStatus
        : armyOrStatus?.state || armyOrStatus?.status;

    return legacyStateMap[status] || ArmyState.STANDBY;
}

function setArmyState(army, state) {
    if (army) army.state = state;
    return army;
}

function isArmyMoving(army) {
    return normalizeArmyState(army) === ArmyState.MOVING;
}

function isArmyInCombat(army) {
    return normalizeArmyState(army) === ArmyState.COMBAT;
}

module.exports = {
    ArmyState,
    normalizeArmyState,
    setArmyState,
    isArmyMoving,
    isArmyInCombat
};
