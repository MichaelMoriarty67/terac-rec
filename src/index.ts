
interface Rand{
    id: number
    name: string
}

export function doSomethingTs(rand: Rand | void){
    console.log("Blaaaah")
}