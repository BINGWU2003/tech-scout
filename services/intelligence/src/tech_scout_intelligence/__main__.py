import uvicorn


def main() -> None:
    uvicorn.run(
        "tech_scout_intelligence.app:app",
        host="127.0.0.1",
        port=8001,
        loop="asyncio:SelectorEventLoop",
    )


if __name__ == "__main__":
    main()
